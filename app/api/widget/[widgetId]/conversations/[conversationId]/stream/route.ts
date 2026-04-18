import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'
import { addSubscriber, removeSubscriber, formatSSE } from '@/lib/widget-sse'

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

  const stream = new ReadableStream({
    start(controller) {
      const sub = {
        id: subId,
        write: (msg: any) => {
          try {
            controller.enqueue(formatSSE(msg))
          } catch { /* controller closed */ }
        },
        close: () => {
          try { controller.close() } catch {}
        },
      }
      addSubscriber(conversationId, sub)

      // Initial hello
      controller.enqueue(formatSSE({ type: 'hello', subId, conversationId }))

      // Keepalive comments every 25 seconds (defeats proxies that close idle connections)
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(': keepalive\n\n'))
        } catch {
          clearInterval(keepalive)
        }
      }, 25000)

      // On abort (client disconnect), remove the subscriber
      const cleanup = () => {
        clearInterval(keepalive)
        removeSubscriber(conversationId, sub)
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
