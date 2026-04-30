import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { formatSSE } from '@/lib/widget-sse'
import { subscribe } from '@/lib/widget-pubsub'

export const maxDuration = 300

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

  let pending: unknown[] | null = []
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
    console.error('[op-stream] failed to open pubsub subscription:', err.message)
    return new Response(JSON.stringify({ error: 'stream unavailable' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    })
  }

  const stream = new ReadableStream({
    start(controller) {
      deliver = (msg) => {
        try { controller.enqueue(formatSSE(msg as any)) } catch {}
      }
      for (const msg of pending!) deliver(msg)
      pending = null

      onPubsubError = (err) => {
        console.warn('[op-stream] pubsub error, closing SSE:', err.message)
        try { controller.close() } catch {}
      }

      controller.enqueue(formatSSE({ type: 'hello', subId, conversationId }))

      const keepalive = setInterval(() => {
        try { controller.enqueue(new TextEncoder().encode(': keepalive\n\n')) }
        catch { clearInterval(keepalive) }
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
    },
  })
}
