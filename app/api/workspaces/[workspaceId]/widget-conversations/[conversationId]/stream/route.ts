import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { addSubscriber, removeSubscriber, formatSSE } from '@/lib/widget-sse'

type Params = { params: Promise<{ workspaceId: string; conversationId: string }> }

/**
 * GET /api/workspaces/:workspaceId/widget-conversations/:conversationId/stream
 *
 * Operator-side SSE feed. Mirrors the visitor-side widget stream but
 * authenticates via the dashboard session instead of a public widget key.
 * Same events fan out: agent_message, visitor_message, agent_typing,
 * visitor_typing, operator_typing, agent_error.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof Response) return access

  // Verify conversation belongs to this workspace
  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widget: { workspaceId } },
    select: { id: true },
  })
  if (!convo) {
    return new Response(JSON.stringify({ error: 'Conversation not found' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  const subId = 'op_' + Math.random().toString(36).slice(2, 10)
  const stream = new ReadableStream({
    start(controller) {
      const sub = {
        id: subId,
        write: (msg: any) => {
          try { controller.enqueue(formatSSE(msg)) } catch {}
        },
        close: () => { try { controller.close() } catch {} },
      }
      addSubscriber(conversationId, sub)
      controller.enqueue(formatSSE({ type: 'hello', subId, conversationId }))

      const keepalive = setInterval(() => {
        try { controller.enqueue(new TextEncoder().encode(': keepalive\n\n')) }
        catch { clearInterval(keepalive) }
      }, 25000)

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
    },
  })
}
