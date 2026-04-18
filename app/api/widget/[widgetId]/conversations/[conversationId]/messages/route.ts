import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'
import { WidgetAdapter } from '@/lib/widget-adapter'
import { broadcast } from '@/lib/widget-sse'
import { runAgent } from '@/lib/ai-agent'
import { findMatchingAgent } from '@/lib/routing'
import { buildKnowledgeBlock } from '@/lib/rag'
import { buildObjectivesBlockForAgent } from '@/lib/agent-objectives'

type Params = { params: Promise<{ widgetId: string; conversationId: string }> }

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: widgetCorsHeaders(req.headers.get('origin')),
  })
}

/**
 * POST /api/widget/:widgetId/conversations/:conversationId/messages
 * Body: { content }
 *
 * Visitor sends a message. Server:
 *  1. Persists the visitor message + broadcasts to SSE (for echo)
 *  2. Fires runAgent in background — reply flows back via SSE through the
 *     WidgetAdapter's sendMessage override
 *  3. Returns 202 Accepted immediately (the widget doesn't wait for the
 *     reply — SSE delivers it)
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { widgetId, conversationId } = await params
  const v = await validateWidgetRequest(req, widgetId)
  const headers = widgetCorsHeaders(req.headers.get('origin'))
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers })

  let body: any = {}
  try { body = await req.json() } catch {}
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) return NextResponse.json({ error: 'content required' }, { status: 400, headers })
  if (content.length > 4000) return NextResponse.json({ error: 'content too long' }, { status: 400, headers })

  // Load conversation + verify it belongs to this widget
  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widgetId },
    include: { visitor: true, widget: true },
  })
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404, headers })

  // Persist the visitor message
  const visitorMsg = await db.widgetMessage.create({
    data: { conversationId, role: 'visitor', content, kind: 'text' },
  })
  await db.widgetConversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  })

  // Echo the visitor message back via SSE so other tabs/subscribers see it
  broadcast(conversationId, {
    type: 'visitor_message',
    id: visitorMsg.id,
    content,
    createdAt: visitorMsg.createdAt.toISOString(),
  })

  // Respond to widget immediately — agent reply flows back on SSE
  const response = NextResponse.json({ ok: true, messageId: visitorMsg.id }, { headers })

  // Fire the agent in a non-blocking promise. We intentionally don't await
  // — Vercel will keep the function alive via waitUntil semantics since
  // Next hasn't closed the response until the stream is drained.
  runWidgetAgent({ convo, content }).catch(err => {
    console.error('[widget] agent run failed:', err)
    broadcast(conversationId, {
      type: 'agent_error',
      message: 'Agent failed to respond. Please try again.',
    })
  })

  return response
}

async function runWidgetAgent(params: {
  convo: any
  content: string
}) {
  const { convo, content } = params
  const widget = convo.widget

  // Resolve the agent: defaultAgentId on the widget, else findMatchingAgent
  let agent: any = null
  if (widget.defaultAgentId) {
    agent = await db.agent.findFirst({
      where: { id: widget.defaultAgentId, workspaceId: widget.workspaceId, isActive: true },
      include: {
        knowledgeEntries: true, routingRules: true, stopConditions: true,
        followUpSequences: true, qualifyingQuestions: true, channelDeployments: true,
      },
    })
  }
  if (!agent) {
    // Use routing — requires an agent with a Live_Chat deployment (or none at all)
    // Find any location in the workspace to seed routing
    const loc = await db.location.findFirst({
      where: { workspaceId: widget.workspaceId },
      select: { id: true },
    })
    if (loc) {
      agent = await findMatchingAgent(loc.id, `visitor:${convo.visitorId}`, content, 'Live_Chat')
    }
  }

  if (!agent) {
    broadcast(convo.id, {
      type: 'agent_error',
      message: 'No agent is configured to handle this widget. Add a default agent in the widget settings.',
    })
    return
  }

  // Broadcast typing indicator
  broadcast(convo.id, { type: 'agent_typing', isTyping: true })

  // Build full system prompt — same pattern as the webhook handler
  let fullPrompt = agent.systemPrompt
  fullPrompt += await buildObjectivesBlockForAgent(agent.id, content)
  if (agent.instructions) fullPrompt += `\n\n## Additional Instructions\n${agent.instructions}`
  fullPrompt += buildKnowledgeBlock(agent.knowledgeEntries, content)

  if (agent.calendarId && agent.enabledTools.some((t: string) => ['get_available_slots', 'book_appointment'].includes(t))) {
    fullPrompt += `\n\n## Calendar Configuration
Calendar ID for booking: ${agent.calendarId}
Contact ID for this conversation: visitor:${convo.visitorId}

Note: This conversation is happening on a website chat widget. When booking, use the visitor's email (ask for it if not provided — it's required for the calendar invite).`
  }

  // Build recent history
  const recent = await db.widgetMessage.findMany({
    where: { conversationId: convo.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  const history = recent.reverse().slice(0, -1).map(m => ({
    id: m.id,
    conversationId: convo.id,
    locationId: `widget:${convo.widgetId}`,
    contactId: `visitor:${convo.visitorId}`,
    body: m.content,
    direction: m.role === 'visitor' ? 'inbound' as const : 'outbound' as const,
  }))

  const adapter = new WidgetAdapter({
    widgetId: convo.widgetId,
    conversationId: convo.id,
    inner: null, // TODO: pass real CRM adapter if workspace has one + agent has calendarId
  })

  try {
    await runAgent({
      locationId: `widget:${convo.widgetId}`,
      agentId: agent.id,
      contactId: `visitor:${convo.visitorId}`,
      conversationId: convo.id,
      channel: 'Live_Chat',
      incomingMessage: content,
      messageHistory: history,
      systemPrompt: fullPrompt,
      enabledTools: agent.enabledTools,
      workflowPicks: {
        addTo: ((agent as any).addToWorkflowsPick ?? undefined) as any,
        removeFrom: ((agent as any).removeFromWorkflowsPick ?? undefined) as any,
      },
      persona: {
        agentPersonaName: agent.agentPersonaName,
        responseLength: agent.responseLength,
        formalityLevel: agent.formalityLevel,
        useEmojis: agent.useEmojis,
        neverSayList: agent.neverSayList,
        simulateTypos: agent.simulateTypos,
        typingDelayEnabled: agent.typingDelayEnabled,
        typingDelayMinMs: agent.typingDelayMinMs,
        typingDelayMaxMs: agent.typingDelayMaxMs,
        languages: agent.languages,
      },
      adapter,
    } as any)
  } finally {
    broadcast(convo.id, { type: 'agent_typing', isTyping: false })
  }
}
