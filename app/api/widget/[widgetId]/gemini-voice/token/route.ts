import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { validateWidgetRequest, widgetCorsHeaders, resolveVoiceAgentId } from '@/lib/widget-auth'
import { buildGeminiVoiceSession } from '@/lib/voice/gemini/session'
import {
  mintGeminiVoiceToken,
  GeminiVoiceNotConfiguredError,
  GeminiVoiceTokenMintError,
} from '@/lib/voice/gemini/mint'
import { geminiVoiceModel } from '@/lib/voice/gemini/voice-config'

type Params = { params: Promise<{ widgetId: string }> }

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: widgetCorsHeaders(req.headers.get('origin')) })
}

/**
 * POST { conversationId } — public Gemini voice token for the chat widget.
 *
 * Auth: widget public key + origin (validateWidgetRequest). Resolves the
 * widget's voice agent, requires voiceRuntime 'gemini' + an active
 * GeminiVoiceConfig, mints a scoped ephemeral token, and creates the
 * WidgetVoiceCall row the transcript route later finalizes.
 *
 * When the widget's agent is NOT a Gemini agent, returns code 'NOT_GEMINI'
 * so the embed page falls back to the existing Vapi voice path.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { widgetId } = await params
  const cors = widgetCorsHeaders(req.headers.get('origin'))
  const v = await validateWidgetRequest(req, widgetId)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers: cors })

  if (!v.widget.voiceEnabled) {
    return NextResponse.json({ error: 'Voice not enabled for this widget' }, { status: 400, headers: cors })
  }

  const body = (await req.json().catch(() => ({}))) as { conversationId?: string; agentId?: string }
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId required' }, { status: 400, headers: cors })
  }
  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widgetId },
    select: { id: true },
  })
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404, headers: cors })

  // Launcher voice entries may name a specific agent (validated against
  // the configured entries inside the resolver).
  const agentId = resolveVoiceAgentId(v.widget as any, body?.agentId)
  if (!agentId) {
    return NextResponse.json({ error: 'No voice agent configured on this widget' }, { status: 400, headers: cors })
  }
  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId: v.widget.workspaceId },
    select: {
      id: true, name: true, systemPrompt: true, instructions: true,
      enabledTools: true, locationId: true, workspaceId: true, voiceRuntime: true,
    },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404, headers: cors })
  if (agent.voiceRuntime !== 'gemini') {
    return NextResponse.json({ error: 'This agent does not use Gemini voice', code: 'NOT_GEMINI' }, { status: 400, headers: cors })
  }
  const config = await db.geminiVoiceConfig.findUnique({ where: { agentId: agent.id } })
  if (!config || !config.isActive) {
    return NextResponse.json({ error: 'Gemini voice is not active for this agent', code: 'GEMINI_INACTIVE' }, { status: 400, headers: cors })
  }

  // Abuse guard: at most one live Gemini widget call per conversation.
  const live = await db.widgetVoiceCall.count({
    where: { conversationId, status: { in: ['requested', 'live'] } },
  })
  if (live > 0) {
    return NextResponse.json({ error: 'A voice call is already in progress', code: 'CALL_IN_PROGRESS' }, { status: 429, headers: cors })
  }

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
      voiceName: config.voiceName,
      model: config.model || geminiVoiceModel(),
      firstMessage: config.firstMessage,
      endCallMessage: config.endCallMessage,
      language: config.language,
      maxDurationSecs: config.maxDurationSecs,
    },
  )

  try {
    const minted = await mintGeminiVoiceToken(session)
    const call = await db.widgetVoiceCall.create({
      data: { conversationId, status: 'live' },
    })
    return NextResponse.json({
      callId: call.id,
      agentId: agent.id,
      connection: {
        token: minted.token,
        vendorModelId: minted.vendorModelId,
        provider: 'gemini-live' as const,
        maxSessionSecs: minted.maxSessionSecs,
        frameFpsCap: 0,
      },
      tools: session.tools,
      vendorConfig: session.liveConfig,
    }, { headers: cors })
  } catch (err) {
    if (err instanceof GeminiVoiceNotConfiguredError) {
      return NextResponse.json({ error: 'Voice is not available right now.', code: 'GEMINI_NOT_CONFIGURED' }, { status: 503, headers: cors })
    }
    if (err instanceof GeminiVoiceTokenMintError) {
      return NextResponse.json({ error: 'Could not start the call right now.', code: 'GEMINI_TOKEN_MINT_FAILED' }, { status: 502, headers: cors })
    }
    throw err
  }
}
