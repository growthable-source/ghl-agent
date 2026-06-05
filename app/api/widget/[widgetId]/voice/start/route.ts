import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'
import { VAPI_TOOLS, buildVoiceSystemPrompt } from '@/lib/voice-prompt'
import { buildVapiVoiceBlock, resolveVoiceEngine } from '@/lib/voice/vapi-adapter'

type Params = { params: Promise<{ widgetId: string }> }

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: widgetCorsHeaders(req.headers.get('origin')),
  })
}

/**
 * POST /api/widget/:widgetId/voice/start
 * Body: { conversationId }
 *
 * Creates a WidgetVoiceCall row and returns everything the browser needs
 * to start a WebRTC call with VAPI using @vapi-ai/web.
 *
 * The browser uses a VAPI_PUBLIC_KEY (different from server API key) — set
 * it in the VAPI dashboard and expose via env var NEXT_PUBLIC_VAPI_PUBLIC_KEY.
 * Assistant config is built server-side and passed as an override so visitors
 * never see our system prompt.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { widgetId } = await params
  const v = await validateWidgetRequest(req, widgetId)
  const headers = widgetCorsHeaders(req.headers.get('origin'))
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers })

  // Click-to-call widgets are voice-only by definition; chat widgets need the toggle
  const voiceOk = v.widget.voiceEnabled || v.widget.type === 'click_to_call'
  if (!voiceOk) {
    return NextResponse.json({ error: 'Voice not enabled for this widget' }, { status: 400, headers })
  }

  let body: any = {}
  try { body = await req.json() } catch {}
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : null
  if (!conversationId) return NextResponse.json({ error: 'conversationId required' }, { status: 400, headers })

  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widgetId },
    include: { visitor: { select: { id: true, name: true, email: true, phone: true } } },
  })
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404, headers })

  // Pick the voice agent: widget.voiceAgentId > widget.defaultAgentId
  const agentId = v.widget.voiceAgentId || v.widget.defaultAgentId
  if (!agentId) {
    return NextResponse.json({ error: 'No voice agent configured on this widget' }, { status: 400, headers })
  }

  const agent: any = await db.agent.findFirst({
    where: { id: agentId, workspaceId: v.widget.workspaceId },
    include: { vapiConfig: true },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404, headers })

  // Hydrate knowledge via the workspace junction (single source of truth).
  const { bulkLoadKnowledgeForAgents } = await import('@/lib/knowledge')
  const map = await bulkLoadKnowledgeForAgents([agent.id])
  agent.knowledgeEntries = map.get(agent.id) ?? []
  if (!agent.vapiConfig) {
    return NextResponse.json({ error: 'Agent has no voice configuration. Set up voice on the agent first.' }, { status: 400, headers })
  }

  const vapiPublicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY || process.env.VAPI_PUBLIC_KEY
  if (!vapiPublicKey) {
    return NextResponse.json({
      error: 'VAPI_PUBLIC_KEY not set in server env — set NEXT_PUBLIC_VAPI_PUBLIC_KEY to enable web voice',
    }, { status: 500, headers })
  }

  // Record the call intent
  const call = await db.widgetVoiceCall.create({
    data: { conversationId, status: 'requested' },
  })

  // Resolve the registered Vapi assistant id. The widget references
  // the assistant by id at vapi.start() time — no inline config
  // (matches the browser test path and outbound phone path).
  let vapiAssistantId: string
  try {
    const { ensureVapiAssistant } = await import('@/lib/voice/vapi-assistant')
    vapiAssistantId = await ensureVapiAssistant(agent.id)
  } catch (err: any) {
    return NextResponse.json({
      error: `Could not register Vapi assistant for this agent: ${err?.message ?? 'unknown'}`,
    }, { status: 500, headers })
  }

  return NextResponse.json({
    callId: call.id,
    vapiPublicKey,
    // Widget passes assistantId + overrides to vapi.start() — overrides
    // carry visitor context the assistant's system prompt can read.
    assistantId: vapiAssistantId,
    assistantOverrides: {
      ...(agent.vapiConfig.firstMessage || convo.visitor.name
        ? { firstMessage: agent.vapiConfig.firstMessage || `Hi${convo.visitor.name ? ' ' + convo.visitor.name : ''}, how can I help?` }
        : {}),
      variableValues: {
        widgetConversationId: conversationId,
        widgetCallId: call.id,
        agentId: agent.id,
        workspaceId: v.widget.workspaceId,
      },
    },
  }, { headers })
}
