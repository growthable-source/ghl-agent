import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'
import { broadcast } from '@/lib/widget-sse'
import { notify } from '@/lib/notifications'
import { resolveHandoverLink } from '@/lib/handover-link'
import { runWidgetAgent } from '@/lib/widget-agent-runner'

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

