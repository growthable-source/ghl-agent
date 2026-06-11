/**
 * Co-Pilot session service — the shared core behind BOTH surfaces:
 *
 *   - staff/dashboard routes (/api/copilot/sessions/*) — NextAuth +
 *     workspace membership, onboarding-workflow persona, full tool set
 *   - widget/visitor routes (/api/widget/[widgetId]/copilot/*) —
 *     publicKey auth, business-expert persona, knowledge tool only
 *
 * The routes own AUTH; this module owns everything else (token mint,
 * prompt assembly, persistence, tool execution, session end + Haiku
 * analysis + ticketing). One source of truth so the two surfaces
 * can't drift.
 */

import { GoogleGenAI, Modality, Behavior, Type } from '@google/genai'
import { db } from '@/lib/db'
import { retrieveChunks } from '@/lib/ingest/retrieve'
import { COPILOT_DEFAULTS } from './config'
import { getWorkspaceSetupState } from './setup-state'
import { getWorkflow, DEFAULT_WORKFLOW_KEY } from './workflows'
import { buildCopilotSystemPrompt, buildWidgetCopilotPrompt } from './prompt'
import { COPILOT_TOOL_DEFS, WIDGET_TOOL_DEFS, executeCopilotTool } from './tools'
import { analyzeSessionAndFollowUp, type SessionAnalysis } from './analyze'
import type { CopilotSessionDTO, RealtimeToolDef } from './types'

// ─── DTO ────────────────────────────────────────────────────────────

interface SessionRowForDTO {
  id: string
  workspaceId: string
  channel: string
  status: string
  model: string | null
  roomId: string | null
  locale: string
  workflowKey: string | null
  startedAt: Date
  endedAt: Date | null
  durationSecs: number | null
  endedReason: string | null
  toolCallCount: number
}

export function toCopilotSessionDTO(row: SessionRowForDTO): CopilotSessionDTO {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    channel: row.channel as CopilotSessionDTO['channel'],
    status: row.status as CopilotSessionDTO['status'],
    model: row.model as CopilotSessionDTO['model'],
    roomId: row.roomId,
    locale: row.locale,
    workflowKey: row.workflowKey,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    durationSecs: row.durationSecs,
    endedReason: row.endedReason,
    toolCallCount: row.toolCallCount,
  }
}

// ─── Ephemeral token mint ───────────────────────────────────────────

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

export class CopilotNotConfiguredError extends Error {}
export class CopilotTokenMintError extends Error {}
export class CopilotSopNotFoundError extends Error {}

async function mintEphemeralToken(systemPrompt: string, toolDefs: RealtimeToolDef[], maxSessionSecsOverride?: number) {
  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) throw new CopilotNotConfiguredError('missing GEMINI_API_KEY')

  const { vendorModelId, frameFpsCap } = COPILOT_DEFAULTS
  const maxSessionSecs = Math.min(
    COPILOT_DEFAULTS.maxSessionSecs,
    maxSessionSecsOverride && maxSessionSecsOverride > 60 ? maxSessionSecsOverride : COPILOT_DEFAULTS.maxSessionSecs,
  )

  // Optional voice override (e.g. 'Puck', 'Kore') — without it Gemini
  // uses its default native voice. Locale still steers the accent.
  const voiceName = process.env.COPILOT_VOICE || null

  const liveConfig = {
    responseModalities: [Modality.AUDIO],
    systemInstruction: systemPrompt,
    tools: [{ functionDeclarations: toGeminiFunctionDeclarations(toolDefs) }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: {},
    ...(voiceName
      ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } } }
      : {}),
  }

  const now = Date.now()
  try {
    const ai = new GoogleGenAI({ apiKey: geminiKey })
    const token = await ai.authTokens.create({
      config: {
        // >1 use: the WS connection drops ~10 min in and the client
        // reconnects with its sessionResumption handle.
        uses: 10,
        expireTime: new Date(now + (maxSessionSecs + 300) * 1000).toISOString(),
        newSessionExpireTime: new Date(now + maxSessionSecs * 1000).toISOString(),
        liveConnectConstraints: { model: vendorModelId, config: liveConfig },
        httpOptions: { apiVersion: 'v1alpha' },
      },
    })
    if (!token.name) throw new Error('token response missing name')
    return {
      realtime: {
        token: token.name,
        vendorModelId,
        provider: 'gemini-live' as const,
        maxSessionSecs,
        frameFpsCap,
      },
      liveConfig,
    }
  } catch (err) {
    if (err instanceof CopilotNotConfiguredError) throw err
    console.error('[Copilot] ephemeral token mint failed:', err)
    throw new CopilotTokenMintError(err instanceof Error ? err.message : String(err))
  }
}

function normalizeLocale(locale: unknown): string {
  return typeof locale === 'string' && /^[a-zA-Z-]{2,16}$/.test(locale) ? locale : 'en-AU'
}

// ─── Create: staff (dashboard) ──────────────────────────────────────

export type StaffCopilotMode = 'onboarding' | 'general' | 'sop'

export async function createStaffSession(opts: {
  workspaceId: string
  userId: string
  locale?: string
  workflowKey?: string | null
  /** 'onboarding' (default, built-in workflow), 'general' (fix
   *  anything), or 'sop' (run a workspace-authored procedure). */
  mode?: StaffCopilotMode
  sopId?: string | null
  /** Run AS a workspace-created Co-Pilot agent (overrides mode). */
  agentId?: string | null
}) {
  const locale = normalizeLocale(opts.locale)
  const mode: StaffCopilotMode = opts.mode === 'general' || opts.mode === 'sop' ? opts.mode : 'onboarding'

  const setupState = await getWorkspaceSetupState(opts.workspaceId)

  let systemPrompt: string
  let workflowKey: string | null = null
  let maxSecsOverride: number | undefined
  let copilotAgentId: string | null = null

  if (opts.agentId) {
    // Run as a workspace-created Co-Pilot agent: persona + optional
    // procedure + recording-distilled playbook + scoped knowledge.
    const agent = await db.copilotAgent.findFirst({ where: { id: opts.agentId, workspaceId: opts.workspaceId } })
    if (!agent) throw new CopilotSopNotFoundError('Co-Pilot agent not found')
    copilotAgentId = agent.id
    const steps = Array.isArray(agent.steps) ? (agent.steps as string[]).filter(s => typeof s === 'string') : []
    const domainIds = agent.knowledgeDomainIds ?? []
    const ragChunks = await retrieveChunks(opts.workspaceId, `${agent.name} ${steps.join(' ')}`.slice(0, 400) || agent.name, {
      limit: 4,
      knowledgeDomainIds: domainIds.length ? domainIds : undefined,
    })
    const ragContext = ragChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n').slice(0, 5000)
    const { buildAgentPrompt } = await import('./prompt')
    systemPrompt = buildAgentPrompt({
      agent: { name: agent.name, persona: agent.persona, goal: null, steps, timeboxMinutes: agent.timeboxMinutes, playbook: agent.playbook },
      workspaceName: setupState.workspaceName,
      ragContext,
      locale,
    })
    if (steps.length > 0) maxSecsOverride = (agent.timeboxMinutes + 5) * 60
  } else if (mode === 'sop') {
    const sop = opts.sopId
      ? await db.copilotSop.findFirst({
          where: { id: opts.sopId, workspaceId: opts.workspaceId },
        })
      : null
    if (!sop) throw new CopilotSopNotFoundError('SOP not found')
    const steps = Array.isArray(sop.steps) ? (sop.steps as string[]).filter(s => typeof s === 'string') : []
    const ragChunks = await retrieveChunks(opts.workspaceId, `${sop.title} — ${sop.goal}`, { limit: 4 })
    const ragContext = ragChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n').slice(0, 5000)
    const { buildSopPrompt } = await import('./prompt')
    systemPrompt = buildSopPrompt({
      sop: { title: sop.title, goal: sop.goal, timeboxMinutes: sop.timeboxMinutes, steps },
      workspaceName: setupState.workspaceName,
      ragContext,
      locale,
    })
    // The timebox IS the session ceiling (+5 min of grace to wrap up).
    maxSecsOverride = (sop.timeboxMinutes + 5) * 60
  } else if (mode === 'general') {
    const ragChunks = await retrieveChunks(opts.workspaceId, 'product overview, common problems, troubleshooting and setup how-tos', { limit: 4 })
    const ragContext = ragChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n').slice(0, 5000)
    const { buildGeneralStaffPrompt } = await import('./prompt')
    systemPrompt = buildGeneralStaffPrompt({ workspaceName: setupState.workspaceName, ragContext, locale })
  } else {
    workflowKey = typeof opts.workflowKey === 'string' ? opts.workflowKey.slice(0, 64) : DEFAULT_WORKFLOW_KEY
    const workflow = getWorkflow(workflowKey)
    const ragChunks = await retrieveChunks(opts.workspaceId, `${workflow.title} — how to set up agents, channels and knowledge`, { limit: 4 })
    const ragContext = ragChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n').slice(0, 5000)
    systemPrompt = buildCopilotSystemPrompt({ setupState, workflow, ragContext, locale })
  }

  const { realtime, liveConfig } = await mintEphemeralToken(systemPrompt, COPILOT_TOOL_DEFS, maxSecsOverride)

  const created = await db.copilotSession.create({
    data: {
      workspaceId: opts.workspaceId,
      startedByUserId: opts.userId,
      channel: 'in_app_webrtc',
      locale,
      workflowKey,
      model: 'gemini-live',
      metadata: { mode: 'staff', copilotMode: copilotAgentId ? 'agent' : mode, sopId: opts.sopId ?? null, copilotAgentId, vendorModelId: realtime.vendorModelId },
    },
  })

  return { session: toCopilotSessionDTO(created), realtime, liveConfig, tools: COPILOT_TOOL_DEFS }
}

// ─── Create: widget (visitor) ───────────────────────────────────────

export async function createWidgetSession(opts: {
  workspaceId: string
  widgetId: string
  businessTitle: string
  agentId: string | null
  visitorId: string | null
  locale?: string
}) {
  const locale = normalizeLocale(opts.locale)

  // Knowledge scope follows the widget's agent — empty array means
  // workspace-wide, same semantics the text-agent runtime uses.
  let knowledgeDomainIds: string[] = []
  let agentPersona: string | null = null
  if (opts.agentId) {
    const agent = await db.agent.findFirst({
      where: { id: opts.agentId, workspaceId: opts.workspaceId },
      select: { knowledgeDomainIds: true, systemPrompt: true },
    })
    knowledgeDomainIds = agent?.knowledgeDomainIds ?? []
    agentPersona = agent?.systemPrompt ?? null
  }

  const ragChunks = await retrieveChunks(
    opts.workspaceId,
    `${opts.businessTitle} product overview, common questions and how-tos`,
    { limit: 4, knowledgeDomainIds },
  )
  const ragContext = ragChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n').slice(0, 5000)

  const systemPrompt = buildWidgetCopilotPrompt({
    businessTitle: opts.businessTitle,
    agentPersona,
    ragContext,
    locale,
  })

  const { realtime, liveConfig } = await mintEphemeralToken(systemPrompt, WIDGET_TOOL_DEFS)

  const created = await db.copilotSession.create({
    data: {
      workspaceId: opts.workspaceId,
      channel: 'in_app_webrtc',
      locale,
      workflowKey: null,
      model: 'gemini-live',
      metadata: {
        mode: 'widget',
        widgetId: opts.widgetId,
        visitorId: opts.visitorId,
        agentId: opts.agentId,
        knowledgeDomainIds,
        vendorModelId: realtime.vendorModelId,
      },
    },
  })

  return { session: toCopilotSessionDTO(created), realtime, liveConfig, tools: WIDGET_TOOL_DEFS }
}

// ─── Liveness ───────────────────────────────────────────────────────

export interface ActiveSession {
  id: string
  workspaceId: string
  workflowKey: string | null
  startedAt: Date
  status: string
  metadata: Record<string, unknown>
}

export type LoadResult =
  | { ok: true; session: ActiveSession }
  | { ok: false; reason: 'not_found' | 'ended' | 'expired' }

/**
 * Load a session and enforce the active + max-duration invariants
 * (P0-11). Authorization is the CALLER's job — dashboard routes check
 * workspace membership, widget routes check the widgetId binding.
 */
export async function loadActiveSession(sessionId: string): Promise<LoadResult> {
  const row = await db.copilotSession.findUnique({
    where: { id: sessionId },
    select: { id: true, workspaceId: true, workflowKey: true, startedAt: true, status: true, metadata: true },
  })
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.status !== 'active') return { ok: false, reason: 'ended' }

  const ageSecs = (Date.now() - row.startedAt.getTime()) / 1000
  if (ageSecs > COPILOT_DEFAULTS.maxSessionSecs) {
    await db.copilotSession.update({
      where: { id: row.id },
      data: { status: 'ended', endedAt: new Date(), endedReason: 'max_duration', durationSecs: Math.round(ageSecs) },
    })
    return { ok: false, reason: 'expired' }
  }

  return {
    ok: true,
    session: { ...row, metadata: (row.metadata ?? {}) as Record<string, unknown> },
  }
}

// ─── Tool execution ─────────────────────────────────────────────────

export async function runSessionTool(
  session: ActiveSession,
  name: string,
  args: Record<string, unknown>,
): Promise<{ result: string; latencyMs: number }> {
  const mode = session.metadata.mode === 'widget' ? 'widget' : 'staff'
  const knowledgeDomainIds = Array.isArray(session.metadata.knowledgeDomainIds)
    ? (session.metadata.knowledgeDomainIds as string[])
    : undefined

  const startedAt = Date.now()
  const result = await executeCopilotTool(name, args, {
    workspaceId: session.workspaceId,
    workflowKey: session.workflowKey,
    mode,
    knowledgeDomainIds,
  })
  const latencyMs = Date.now() - startedAt

  await Promise.all([
    db.copilotToolCall.create({
      data: {
        sessionId: session.id,
        workspaceId: session.workspaceId,
        toolName: name,
        args: args as object,
        resultSummary: result.slice(0, 2000),
        latencyMs,
      },
    }),
    db.copilotSession.update({
      where: { id: session.id },
      data: { toolCallCount: { increment: 1 } },
    }),
  ]).catch(err => console.error('[Copilot tool] logging failed:', err))

  return { result, latencyMs }
}

// ─── Event sink ─────────────────────────────────────────────────────

export interface EventBatch {
  turns?: Array<{ role?: string; text?: string; tokens?: number; ts?: string }>
  screenEvents?: Array<{ visionSummary?: string; detectedContext?: Record<string, unknown>; ts?: string }>
  counters?: { audioInSecs?: number; audioOutSecs?: number; videoFrames?: number }
}

const VALID_ROLES = new Set(['user', 'agent', 'system', 'tool'])

function parseTs(ts: string | undefined): Date {
  const d = ts ? new Date(ts) : new Date()
  return isNaN(d.getTime()) ? new Date() : d
}

export async function recordSessionEvents(session: ActiveSession, batch: EventBatch) {
  const turns = (batch.turns ?? []).filter(t => t.text && VALID_ROLES.has(t.role ?? '')).slice(0, 200)
  const screenEvents = (batch.screenEvents ?? [])
    .filter(e => e.visionSummary || e.detectedContext)
    .slice(0, 200)
  const counters = batch.counters ?? {}

  const writes: Promise<unknown>[] = []
  if (turns.length > 0) {
    writes.push(
      db.copilotTranscriptTurn.createMany({
        data: turns.map(t => ({
          sessionId: session.id,
          workspaceId: session.workspaceId,
          role: t.role as string,
          text: (t.text as string).slice(0, 8000),
          tokens: typeof t.tokens === 'number' ? t.tokens : null,
          ts: parseTs(t.ts),
        })),
      }),
    )
  }
  if (screenEvents.length > 0) {
    writes.push(
      db.copilotScreenEvent.createMany({
        data: screenEvents.map(e => ({
          sessionId: session.id,
          workspaceId: session.workspaceId,
          visionSummary: e.visionSummary ? e.visionSummary.slice(0, 4000) : null,
          detectedContext: (e.detectedContext ?? {}) as object,
          ts: parseTs(e.ts),
        })),
      }),
    )
  }
  const audioIn = Number(counters.audioInSecs) || 0
  const audioOut = Number(counters.audioOutSecs) || 0
  const frames = Math.max(0, Math.round(Number(counters.videoFrames) || 0))
  if (audioIn > 0 || audioOut > 0 || frames > 0) {
    writes.push(
      db.copilotSession.update({
        where: { id: session.id },
        data: {
          ...(audioIn > 0 ? { audioInSecs: { increment: audioIn } } : {}),
          ...(audioOut > 0 ? { audioOutSecs: { increment: audioOut } } : {}),
          ...(frames > 0 ? { videoFrames: { increment: frames } } : {}),
        },
      }),
    )
  }
  await Promise.all(writes)
  return { turns: turns.length, screenEvents: screenEvents.length }
}

// ─── End ────────────────────────────────────────────────────────────

export interface EndResult {
  alreadyEnded: boolean
  durationSecs: number
  taskSuccess: boolean | null
  analysis: SessionAnalysis | null
}

/**
 * End a session: flip the row, run the staff workflow-goal eval, then
 * the Haiku transcript analysis (which opens a ticket when the issue
 * went unresolved). Idempotent — racing PATCH vs sendBeacon vs the
 * stale sweep is a no-op for the losers.
 */
export async function endCopilotSession(sessionId: string, endedReason: string): Promise<EndResult> {
  const session = await db.copilotSession.findUnique({
    where: { id: sessionId },
    select: { id: true, workspaceId: true, workflowKey: true, startedAt: true, status: true, metadata: true },
  })
  if (!session) return { alreadyEnded: true, durationSecs: 0, taskSuccess: null, analysis: null }
  if (session.status !== 'active') {
    return { alreadyEnded: true, durationSecs: 0, taskSuccess: null, analysis: null }
  }

  const endedAt = new Date()
  const durationSecs = Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000)
  await db.copilotSession.update({
    where: { id: session.id },
    data: { status: 'ended', endedAt, durationSecs, endedReason: endedReason.slice(0, 64) },
  })

  const meta = (session.metadata ?? {}) as Record<string, unknown>
  const mode = meta.mode === 'widget' ? 'widget' : 'staff'

  // Staff sessions: workflow-goal auto-eval (P0-10). Widget sessions
  // have no workflow — their resolution signal comes from the Haiku
  // analysis below.
  let taskSuccess: boolean | null = null
  if (mode === 'staff' && session.workflowKey) {
    try {
      const state = await getWorkspaceSetupState(session.workspaceId)
      const workflow = getWorkflow(session.workflowKey)
      taskSuccess = workflow.goalReached(state)
      await db.copilotEvalRecord.create({
        data: {
          sessionId: session.id,
          workspaceId: session.workspaceId,
          scope: 'session',
          taskSuccess,
          notes: `auto: workflow=${workflow.key} goal ${taskSuccess ? 'reached' : 'not reached'} at session end`,
        },
      })
    } catch (err) {
      console.error('[Copilot] workflow eval failed:', err)
    }
  }

  const analysis = await analyzeSessionAndFollowUp(session.id)
  if (taskSuccess === null && analysis) taskSuccess = analysis.issueResolved

  return { alreadyEnded: false, durationSecs, taskSuccess, analysis }
}
