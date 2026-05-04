import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { formatSSE, buildResumeId, parseResumeId } from '@/lib/widget-sse'
import { subscribe } from '@/lib/widget-pubsub'

// Stream cycles every ~5 min; reconnects are seamless via Last-Event-ID
// backfill, mirroring the visitor-side widget stream.
export const maxDuration = 300

const RESUME_MAX_MESSAGES = 200
const HEARTBEAT_INTERVAL_MS = 20_000

type Params = { params: Promise<{ workspaceId: string; conversationId: string }> }

/**
 * GET /api/workspaces/:workspaceId/widget-conversations/:conversationId/stream
 *
 * Operator-side SSE feed. Mirrors the visitor-side widget stream but
 * authenticates via the dashboard session instead of a public widget key.
 * Same events fan out: agent_message, visitor_message, agent_typing,
 * visitor_typing, operator_typing, agent_error.
 *
 * Resume contract matches the widget endpoint: persistable messages
 * carry an SSE `id:` of `<isoCreatedAt>|<msgId>`; on reconnect the
 * client's `Last-Event-ID` (or explicit `?since=`) drives backfill so
 * messages aren't lost across the maxDuration cycle.
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

  const lastEventIdHeader = req.headers.get('last-event-id')
  const sinceParam = new URL(req.url).searchParams.get('since')
  const resumeFrom = parseResumeId(lastEventIdHeader || sinceParam)

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
    async start(controller) {
      try { controller.enqueue(new TextEncoder().encode(': ready\n\n')) } catch {}

      let liveReady = false
      const liveBuffer: unknown[] = []
      const enqueueLive = (msg: any) => {
        if (msg && typeof msg === 'object') {
          const t = msg.type
          if (t === 'agent_message' || t === 'visitor_message') {
            const id = msg.id && msg.createdAt ? buildResumeId(msg.createdAt, msg.id) : undefined
            try { controller.enqueue(formatSSE(msg, id ? { id } : undefined)) } catch {}
            return
          }
        }
        try { controller.enqueue(formatSSE(msg as any)) } catch {}
      }
      deliver = (msg) => {
        if (!liveReady) { liveBuffer.push(msg); return }
        enqueueLive(msg)
      }
      for (const msg of pending!) liveBuffer.push(msg)
      pending = null

      onPubsubError = (err) => {
        console.warn('[op-stream] pubsub error, closing SSE:', err.message)
        try { controller.close() } catch {}
      }

      try {
        controller.enqueue(formatSSE({ type: 'hello', subId, conversationId, resumed: !!resumeFrom }))
      } catch {}

      if (resumeFrom) {
        try {
          const missed = await db.widgetMessage.findMany({
            where: {
              conversationId,
              OR: [
                { createdAt: { gt: resumeFrom.createdAt } },
                {
                  AND: [
                    { createdAt: { equals: resumeFrom.createdAt } },
                    { id: { gt: resumeFrom.messageId } },
                  ],
                },
              ],
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: RESUME_MAX_MESSAGES + 1,
            select: { id: true, role: true, content: true, kind: true, createdAt: true },
          })
          const truncated = missed.length > RESUME_MAX_MESSAGES
          const toReplay = truncated ? missed.slice(0, RESUME_MAX_MESSAGES) : missed
          for (const m of toReplay) {
            const evt = {
              type: m.role === 'agent' ? 'agent_message' : 'visitor_message',
              id: m.id,
              content: m.content,
              kind: m.kind,
              createdAt: m.createdAt.toISOString(),
            }
            try {
              controller.enqueue(formatSSE(evt, { id: buildResumeId(m.createdAt, m.id) }))
            } catch {}
          }
          if (truncated) {
            try {
              controller.enqueue(formatSSE({
                type: 'resume_truncated',
                replayed: toReplay.length,
              }))
            } catch {}
          }
        } catch (err: any) {
          console.warn('[op-stream] backfill failed:', err?.message)
        }
      }

      for (const msg of liveBuffer) enqueueLive(msg)
      liveBuffer.length = 0
      liveReady = true

      const heartbeat = setInterval(() => {
        try { controller.enqueue(formatSSE({ type: 'ping', t: Date.now() })) }
        catch { clearInterval(heartbeat) }
      }, HEARTBEAT_INTERVAL_MS)

      const cleanup = () => {
        clearInterval(heartbeat)
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
