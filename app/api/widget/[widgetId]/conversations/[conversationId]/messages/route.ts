import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'
import { WidgetAdapter } from '@/lib/widget-adapter'
import { broadcast } from '@/lib/widget-sse'
import { runAgent } from '@/lib/ai-agent'
import { findMatchingAgent } from '@/lib/routing'
import { buildKnowledgeBlock } from '@/lib/rag'
import { buildObjectivesBlockForAgent } from '@/lib/agent-objectives'
import {
  getOrCreateConversationState,
  checkStopConditions,
  executeStopConditionActions,
  pauseConversation,
  incrementMessageCount,
} from '@/lib/conversation-state'
import { notify } from '@/lib/notifications'
import { resolveHandoverLink } from '@/lib/handover-link'

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

  // Detect "new conversation" BEFORE persisting the visitor message so the
  // count reflects prior visitor messages, not this one. First visitor
  // message on an unclaimed thread fires widget.new_conversation so whoever
  // monitors the inbox can jump in.
  const priorVisitorCount = await db.widgetMessage.count({
    where: { conversationId, role: 'visitor' },
  })
  const isFirstVisitorMessage = priorVisitorCount === 0

  // Persist the visitor message
  const visitorMsg = await db.widgetMessage.create({
    data: { conversationId, role: 'visitor', content, kind: 'text' },
  })
  await db.widgetConversation.update({
    where: { id: conversationId },
    // Clear staleNotifiedAt so the stale-cron can page again next time this
    // thread goes quiet. Without this the cron debounce would persist
    // forever across multiple quiet periods.
    data: { lastMessageAt: new Date(), staleNotifiedAt: null },
  })

  // Fire new-conversation notification — fire-and-forget so the widget
  // never waits on Slack/Discord/etc.
  if (isFirstVisitorMessage && convo.widget.workspaceId) {
    ;(async () => {
      try {
        const link = resolveHandoverLink({
          workspaceId: convo.widget.workspaceId,
          locationId: `widget:${widgetId}`,
          conversationId,
          channel: 'Live_Chat',
        })
        const preview = content.length > 120 ? content.slice(0, 117) + '…' : content
        await notify({
          workspaceId: convo.widget.workspaceId,
          event: 'widget.new_conversation',
          title: `New chat on ${convo.widget.name || 'your widget'}`,
          body: `Visitor said: "${preview}"`,
          link,
          severity: 'info',
        })
      } catch (err: any) {
        console.warn('[widget] new-conversation notify failed:', err?.message)
      }
    })()
  }

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

  // Ensure conversation state exists + message count stays accurate for
  // stop-condition evaluation (MESSAGE_COUNT rules rely on the count).
  const widgetLocationId = `widget:${convo.widgetId}`
  const widgetContactId = `visitor:${convo.visitorId}`
  await getOrCreateConversationState(agent.id, widgetLocationId, widgetContactId, convo.id).catch(() => null)
  await incrementMessageCount(agent.id, widgetContactId).catch(() => null)

  try {
    const result = await runAgent({
      locationId: widgetLocationId,
      agentId: agent.id,
      contactId: widgetContactId,
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

    // Stop-condition evaluation — same pattern the webhook handler uses for
    // SMS/WhatsApp/etc. so widget threads pause consistently when a rule
    // fires, and pauseConversation() fires the needs_attention notification.
    try {
      const stopCheck = await checkStopConditions(
        agent,
        widgetContactId,
        content,
        result?.actionsPerformed ?? [],
      )
      if (stopCheck.matched && !agent.locationId.startsWith('widget:')) {
        // Only run CRM side-effects (needs-attention tag + workflow
        // enrol/remove) when there's a real GHL location behind the
        // agent. Widget-only agents don't have a CRM target for these.
        await executeStopConditionActions({
          matched: stopCheck.matched,
          locationId: agent.locationId,
          contactId: widgetContactId,
          reason: stopCheck.reason ?? 'condition_met',
        }).catch(() => {})
      }
      if (stopCheck.shouldPause) {
        await pauseConversation(agent.id, widgetContactId, stopCheck.reason ?? 'condition_met')
      }
    } catch (err: any) {
      console.warn('[widget] stop-condition check failed:', err?.message)
    }
  } finally {
    broadcast(convo.id, { type: 'agent_typing', isTyping: false })
  }
}
