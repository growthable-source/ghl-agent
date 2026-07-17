import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { buildGeminiVoiceSession } from '@/lib/voice/gemini/session'
import {
  mintGeminiVoiceToken,
  GeminiVoiceNotConfiguredError,
  GeminiVoiceTokenMintError,
} from '@/lib/voice/gemini/mint'
import { normalizeGeminiVoiceModel } from '@/lib/voice/gemini/voice-config'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/**
 * POST — mint a web ephemeral token for the dashboard "Test voice" call.
 * Returns a RealtimeProviderConfig-shaped body the browser passes to
 * GeminiLiveProvider.connect(). The session config is locked inside the
 * token; vendorConfig echoes liveConfig because the SDK requires it at
 * connect and it must match the constraint byte-for-byte.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: {
      id: true,
      name: true,
      systemPrompt: true,
      instructions: true,
      enabledTools: true,
      locationId: true,
      workspaceId: true,
    },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const config = await db.geminiVoiceConfig.findUnique({ where: { agentId } })

  const session = buildGeminiVoiceSession(
    {
      name: agent.name,
      systemPrompt: agent.systemPrompt,
      instructions: agent.instructions,
      enabledTools: agent.enabledTools,
      locationId: agent.locationId,
      workspaceId: agent.workspaceId,
      agentId: agent.id,
    },
    {
      voiceName: config?.voiceName ?? null,
      model: normalizeGeminiVoiceModel(config?.model),
      firstMessage: config?.firstMessage ?? null,
      endCallMessage: config?.endCallMessage ?? null,
      language: config?.language ?? null,
      maxDurationSecs: config?.maxDurationSecs ?? 600,
    },
  )

  try {
    const minted = await mintGeminiVoiceToken(session)
    return NextResponse.json({
      connection: {
        token: minted.token,
        vendorModelId: minted.vendorModelId,
        provider: 'gemini-live' as const,
        maxSessionSecs: minted.maxSessionSecs,
        frameFpsCap: 0,
      },
      tools: session.tools,
      vendorConfig: session.liveConfig,
    })
  } catch (err) {
    if (err instanceof GeminiVoiceNotConfiguredError) {
      return NextResponse.json(
        { error: 'Gemini voice is not configured (missing GEMINI_API_KEY).', code: 'GEMINI_NOT_CONFIGURED' },
        { status: 503 },
      )
    }
    if (err instanceof GeminiVoiceTokenMintError) {
      return NextResponse.json(
        { error: 'Could not start a Gemini voice session right now.', code: 'GEMINI_TOKEN_MINT_FAILED' },
        { status: 502 },
      )
    }
    throw err
  }
}
