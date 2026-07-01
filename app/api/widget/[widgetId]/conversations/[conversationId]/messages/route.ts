import { NextRequest, NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'
import { broadcast } from '@/lib/widget-sse'
import { notify } from '@/lib/notifications'
import { resolveHandoverLink } from '@/lib/handover-link'
import { runWidgetAgent } from '@/lib/widget-agent-runner'
import { translateMessageInBackground } from '@/lib/widget-translation'

export const maxDuration = 300

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
    // forever across multiple quiet periods. escalatedNotifiedAt resets too
    // so a re-stalled chat can escalate again.
    data: { lastMessageAt: new Date(), staleNotifiedAt: null, escalatedNotifiedAt: null },
  })

  // Fire new-conversation notification after the response so the widget
  // never waits on Slack/Discord/etc. Wrapped in after() so the work
  // actually completes — bare IIFEs are killed when Vercel suspends.
  if (isFirstVisitorMessage && convo.widget.workspaceId) {
    after(async () => {
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
    })

    // GHL bridge — upsert the contact, tag, and create a follow-up task
    // with a deep link back to our inbox so operators living in GHL
    // still catch the chat. CRM blips never block the visitor.
    after(async () => {
      try {
        const { tagAndTaskOnFirstMessage } = await import('@/lib/widget-crm-sync')
        await tagAndTaskOnFirstMessage({
          workspaceId: convo.widget.workspaceId,
          visitor: convo.visitor as any,
          conversationId,
          widgetName: convo.widget.name || 'widget',
          firstMessage: content,
        })
      } catch (err: any) {
        console.warn('[widget] CRM first-message sync failed:', err?.message)
      }
    })
  }

  // Echo the visitor message back via SSE so other tabs/subscribers see it
  await broadcast(conversationId, {
    type: 'visitor_message',
    id: visitorMsg.id,
    content,
    createdAt: visitorMsg.createdAt.toISOString(),
  })

  // Detect language + translate to English in the background. The
  // visitor doesn't see translation; the operator inbox does, via
  // the translation_update SSE event the helper broadcasts when it
  // lands.
  after(async () => {
    await translateMessageInBackground(visitorMsg.id)
  })

  // Run the agent AFTER the response is sent. Wrapping in `after()` is
  // required on Vercel serverless — without it the runtime tears down the
  // moment we return, killing the agent loop mid-Anthropic-call. That was
  // the cause of "agent goes silent after a random number of turns": the
  // first reply usually beat the suspension, later ones often didn't.
  after(async () => {
    try {
      await runWidgetAgent({ convo, content })
    } catch (err: any) {
      console.error('[widget] agent run failed:', err)
      // Map common account-level failures to specific operator-facing
      // messages so we don't bury a recoverable problem (low Anthropic
      // credits, rate limits) behind a generic "try again." The
      // visitor still sees a graceful "having trouble" — the
      // specifics route to the operator-side system message.
      const raw = (err?.message ?? '') as string
      let message = 'Agent failed to respond. Please try again.'
      if (/credit balance is too low/i.test(raw)) {
        message = 'Agent paused: the workspace\'s Anthropic credit balance is empty. Top up at console.anthropic.com/settings/billing and the agent will resume on the next inbound.'
      } else if (/rate.?limit|429/i.test(raw)) {
        message = 'Agent paused: hitting Anthropic rate limits. The next inbound will retry — if this keeps happening, request a higher rate-limit tier in console.anthropic.com.'
      } else if (/invalid.?api.?key|authentication/i.test(raw)) {
        message = 'Agent paused: the ANTHROPIC_API_KEY env var is missing or invalid on this deployment.'
      } else if (raw) {
        // Surface the underlying message verbatim when we don't have a
        // tailored mapping — easier to debug than the generic.
        message = `Agent failed to respond: ${raw.slice(0, 240)}`
      }
      await broadcast(conversationId, {
        type: 'agent_error',
        message,
      }).catch(() => {})
    }
  })

  // Respond to widget immediately — agent reply flows back on SSE
  return NextResponse.json({ ok: true, messageId: visitorMsg.id }, { headers })
}

