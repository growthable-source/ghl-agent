import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'
import { formatSSE } from '@/lib/widget-sse'
import { subscribe } from '@/lib/widget-pubsub'

// SSE stream stays open until client disconnect or this cap. Vercel Pro
// allows up to 300s; the widget client reconnects on close so this just
// bounds how often the connection cycles.
export const maxDuration = 300

type Params = { params: Promise<{ widgetId: string; conversationId: string }> }

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: widgetCorsHeaders(req.headers.get('origin')) })
}

/**
 * GET /api/widget/:widgetId/conversations/:conversationId/stream?pk=...
 *
 * Long-lived SSE connection. Events:
 *   - visitor_message  (when a visitor posts — echo for other tabs)
 *   - agent_message    (agent reply)
 *   - agent_typing     (typing indicator)
 *   - agent_error
 *   - voice_started / voice_ended
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { widgetId, conversationId } = await params
  const v = await validateWidgetRequest(req, widgetId)
  const cors = widgetCorsHeaders(req.headers.get('origin'))
  if (!v.ok) {
    return new Response(JSON.stringify({ error: v.error }), {
      status: v.status,
      headers: { 'Content-Type': 'application/json', ...cors },
    })
  }

  // Verify conversation belongs to widget
  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widgetId },
    select: { id: true },
  })
  if (!convo) {
    return new Response(JSON.stringify({ error: 'Conversation not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...cors },
    })
  }

  const subId = 'sub_' + Math.random().toString(36).slice(2, 10)

  // Subscribe before we build the stream so a Postgres connection
  // failure surfaces as a 503 instead of a stream that never delivers.
  // Events arriving before the stream's start() callback runs are
  // buffered, then flushed when the controller is ready.
  type PendingEvent = unknown
  let pending: PendingEvent[] | null = []
  let deliver: (msg: unknown) => void = (msg) => { pending!.push(msg) }
  let onPubsubError: (err: Error) => void = () => {}

  let subscription: Awaited<ReturnType<typeof subscribe>>
  try {
    subscription = await subscribe(
      conversationId,
      (msg) => deliver(msg),
      (err) => onPubsubError(err),
    )
  } catch (err: any) {
    console.error('[widget-stream] failed to open pubsub subscription:', err.message)
    return new Response(JSON.stringify({ error: 'stream unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', ...cors },
    })
  }

  const stream = new ReadableStream({
    start(controller) {
      // Now that the controller exists, route events straight through and
      // drain anything that arrived while we were setting up.
      deliver = (msg) => {
        try { controller.enqueue(formatSSE(msg as any)) } catch { /* closed */ }
      }
      for (const msg of pending!) deliver(msg)
      pending = null

      onPubsubError = (err) => {
        console.warn('[widget-stream] pubsub error, closing SSE:', err.message)
        try { controller.close() } catch {}
      }

      controller.enqueue(formatSSE({ type: 'hello', subId, conversationId }))

      // Keepalive comments every 25s — defeats proxies that close idle
      // connections.
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(': keepalive\n\n'))
        } catch {
          clearInterval(keepalive)
        }
      }, 25000)

      const cleanup = () => {
        clearInterval(keepalive)
        subscription.close().catch(() => {})
        try { controller.close() } catch {}
      }
      req.signal.addEventListener('abort', cleanup)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...cors,
    },
  })
}
