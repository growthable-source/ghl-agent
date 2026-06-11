/**
 * Real-time Co-Pilot — session create.
 *
 * POST creates a CopilotSession row and mints a Gemini Live
 * EPHEMERAL TOKEN for the browser to connect with. There is no
 * server-side media worker in v0 (Vercel can't host one): the
 * browser connects directly to the Live API WebSocket. Security
 * model:
 *
 *   - The real GEMINI_API_KEY never leaves the server.
 *   - The ephemeral token is short-lived and locked via
 *     liveConnectConstraints to the exact model id AND full session
 *     config (system prompt, tools, transcription, compression) we
 *     build here — the client cannot swap instructions or tools.
 *   - We echo the same config back to the client because the vendor
 *     SDK requires a matching config at connect time; a mismatch is
 *     rejected against the constraint.
 *
 * Access control: workspace membership (requireWorkspaceAccess) +
 * copilot plan gate (Scale tier OR COPILOT_WORKSPACE_ALLOWLIST).
 *
 * workspaceId arrives in the body, not a route param — the Co-Pilot
 * sidebar entry sits inside a workspace and the UI passes the id of
 * the workspace the user is currently in.
 */

import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenAI, Modality, Behavior, Type } from '@google/genai'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'
import { canUseCopilot } from '@/lib/plans'
import { retrieveChunks } from '@/lib/ingest/retrieve'
import { getWorkspaceSetupState } from '@/lib/copilot/setup-state'
import { getWorkflow, DEFAULT_WORKFLOW_KEY } from '@/lib/copilot/workflows'
import { buildCopilotSystemPrompt } from '@/lib/copilot/prompt'
import { COPILOT_TOOL_DEFS } from '@/lib/copilot/tools'
import { COPILOT_DEFAULTS } from '@/lib/copilot/config'
import type { CreateCopilotSessionInput, CopilotSessionDTO, RealtimeToolDef } from '@/lib/copilot/types'

/**
 * Convert our vendor-neutral tool defs to Gemini functionDeclarations.
 * Declared NON_BLOCKING so the model keeps talking while the tool
 * round-trips through our backend (P0-8 no-dead-air). Tools with no
 * params omit `parameters` entirely — Gemini rejects empty OBJECT
 * property maps.
 */
function toGeminiFunctionDeclarations(defs: RealtimeToolDef[]) {
  return defs.map(d => ({
    name: d.name,
    description: d.description,
    behavior: Behavior.NON_BLOCKING,
    ...(Object.keys(d.parameters.properties).length > 0
      ? {
          parameters: {
            type: Type.OBJECT,
            properties: Object.fromEntries(
              Object.entries(d.parameters.properties).map(([k, v]) => [
                k,
                {
                  type: v.type.toUpperCase() as Type,
                  ...(v.description ? { description: v.description } : {}),
                  ...(v.enum ? { enum: v.enum } : {}),
                },
              ]),
            ),
            ...(d.parameters.required?.length ? { required: d.parameters.required } : {}),
          },
        }
      : {}),
  }))
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { workspaceId?: string } & CreateCopilotSessionInput
  const workspaceId = body.workspaceId

  if (!workspaceId || typeof workspaceId !== 'string') {
    return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
  }

  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  })
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  if (!canUseCopilot(workspace.plan, workspaceId)) {
    return NextResponse.json(
      { error: 'Co-Pilot is not available on your current plan.', code: 'COPILOT_PLAN_GATE' },
      { status: 402 },
    )
  }

  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) {
    return NextResponse.json(
      { error: 'Co-Pilot is not configured on this deployment (missing realtime model credentials).', code: 'COPILOT_NOT_CONFIGURED' },
      { status: 503 },
    )
  }

  const channel = body.channel === 'recall_meeting_bot' ? 'recall_meeting_bot' : 'in_app_webrtc'
  const locale = typeof body.locale === 'string' && body.locale.length <= 16 ? body.locale : 'en-AU'
  const workflowKey =
    typeof body.workflowKey === 'string' ? body.workflowKey.slice(0, 64) : DEFAULT_WORKFLOW_KEY

  // Grounding context (P0-5): live setup state + initial RAG retrieval.
  // retrieveChunks never throws — empty array means no rag block.
  const workflow = getWorkflow(workflowKey)
  const [setupState, ragChunks] = await Promise.all([
    getWorkspaceSetupState(workspaceId),
    retrieveChunks(workspaceId, `${workflow.title} — how to set up agents, channels and knowledge`, { limit: 4 }),
  ])
  const ragContext = ragChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n').slice(0, 5000)

  const systemPrompt = buildCopilotSystemPrompt({ setupState, workflow, ragContext, locale })

  // The full Live session config. Locked into the token AND echoed to
  // the client (the SDK needs a matching config at connect).
  //   - contextWindowCompression: without it, audio+video sessions die
  //     at ~2 minutes; with slidingWindow the session is unlimited.
  //   - sessionResumption: the WS connection itself drops at ~10 min;
  //     the client reconnects with the resumption handle.
  const liveConfig = {
    responseModalities: [Modality.AUDIO],
    systemInstruction: systemPrompt,
    tools: [{ functionDeclarations: toGeminiFunctionDeclarations(COPILOT_TOOL_DEFS) }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: {},
  }

  const { vendorModelId, maxSessionSecs, frameFpsCap } = COPILOT_DEFAULTS
  const now = Date.now()

  let tokenName: string
  try {
    const ai = new GoogleGenAI({ apiKey: geminiKey })
    const token = await ai.authTokens.create({
      config: {
        // >1 use: the WS connection drops around the 10-minute mark and
        // the client reconnects with its sessionResumption handle. Each
        // reconnect consumes a use.
        uses: 10,
        expireTime: new Date(now + (maxSessionSecs + 300) * 1000).toISOString(),
        newSessionExpireTime: new Date(now + maxSessionSecs * 1000).toISOString(),
        liveConnectConstraints: {
          model: vendorModelId,
          config: liveConfig,
        },
        httpOptions: { apiVersion: 'v1alpha' },
      },
    })
    if (!token.name) throw new Error('token response missing name')
    tokenName = token.name
  } catch (err) {
    console.error('[Copilot] ephemeral token mint failed:', err)
    return NextResponse.json(
      { error: 'Could not start a realtime session — the model provider rejected the request.', code: 'COPILOT_TOKEN_MINT_FAILED' },
      { status: 502 },
    )
  }

  const created = await db.copilotSession.create({
    data: {
      workspaceId,
      startedByUserId: access.session.user.id,
      channel,
      locale,
      workflowKey,
      model: 'gemini-live',
      metadata: { vendorModelId },
    },
  })

  const dto: CopilotSessionDTO = {
    id: created.id,
    workspaceId: created.workspaceId,
    channel: created.channel as CopilotSessionDTO['channel'],
    status: created.status as CopilotSessionDTO['status'],
    model: created.model as CopilotSessionDTO['model'],
    roomId: created.roomId,
    locale: created.locale,
    workflowKey: created.workflowKey,
    startedAt: created.startedAt.toISOString(),
    endedAt: null,
    durationSecs: null,
    endedReason: null,
    toolCallCount: 0,
  }

  return NextResponse.json({
    session: dto,
    realtime: {
      token: tokenName,
      vendorModelId,
      provider: 'gemini-live',
      maxSessionSecs,
      frameFpsCap,
    },
    // Echoed so the client's live.connect config matches the token
    // constraint byte-for-byte. The constraint, not this echo, is the
    // security boundary.
    liveConfig,
    tools: COPILOT_TOOL_DEFS,
  })
}
