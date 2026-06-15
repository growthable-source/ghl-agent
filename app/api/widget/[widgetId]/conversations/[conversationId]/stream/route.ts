import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'
import { formatSSE, buildResumeId, parseResumeId } from '@/lib/widget-sse'
import { subscribe } from '@/lib/widget-pubsub'
import { isOperatorOnlyEvent } from '@/lib/widget-visitor-events'

// SSE stream stays open until client disconnect or this cap. Vercel Pro
// allows up to 300s; the widget client reconnects on close so this just
// bounds how often the connection cycles. Reconnects are seamless —
// missed messages are replayed via Last-Event-ID, and the client only
// shows a banner if reconnecting actually fails (network drop, server
// down), not on the routine maxDuration cycle.
export const maxDuration = 300

// Cap how many missed messages we replay on reconnect. A typical widget
// thread is a few dozen turns; if a visitor sat offline long enough to
// miss more than this they should refresh. Keeps the burst-on-resume
// payload bounded.
const RESUME_MAX_MESSAGES = 200

// Heartbeat cadence. Sends a {type:"ping"} event (not a comment) so the
// client's lastSeenAt watchdog can fire onmessage and notice activity —
// SSE comments don't reach the EventSource onmessage handler at all.
const HEARTBEAT_INTERVAL_MS = 20_000

type Params = { params: Promise<{ widgetId: string; conversationId: string }> }

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: widgetCorsHeaders(req.headers.get('origin')) })
}

/**
 * GET /api/widget/:widgetId/conversations/:conversationId/stream?pk=...
 *
 * Long-lived SSE connection. Events:
 *   - hello             once on connect (server greeting)
 *   - ping              periodic keepalive the client uses as a watchdog
 *   - visitor_message   echo of a posted visitor message (resumable)
 *   - agent_message     agent reply (resumable)
 *   - agent_typing      transient typing indicator
 *   - agent_error       transient error toast
 *   - voice_started / voice_ended / status_changed / conversation_assigned
 *
 * Resumable events carry an SSE `id:` of the form `<isoCreatedAt>|<msgId>`.
 * On reconnect the browser sends `Last-Event-ID` and we backfill any
 * persisted messages the client missed before live-tailing.
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

  // Verify conversation belongs to widget. Primary-key lookup, ~1ms
  // warm. Necessary so a different widget's public key can't tail an
  // unrelated conversation just by guessing the cuid.
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

  // Resume marker. EventSource sends Last-Event-ID automatically; we
  // also accept a `since` query param for clients that want to resume
  // explicitly without going through the browser's stored value.
  const lastEventIdHeader = req.headers.get('last-event-id')
  const sinceParam = new URL(req.url).searchParams.get('since')
  const resumeFrom = parseResumeId(lastEventIdHeader || sinceParam)

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
    async start(controller) {
      // First byte ASAP so the browser fires onopen and the client can
      // exit its "reconnecting" state immediately. The SSE comment is
      // ignored by event listeners but counts as data on the wire.
      try { controller.enqueue(new TextEncoder().encode(': ready\n\n')) } catch {}

      // Now that the controller exists, route events straight through.
      // We hold the live tail behind `liveReady` until backfill drains
      // so messages stay strictly in order even if a NOTIFY arrives
      // mid-replay.
      let liveReady = false
      const liveBuffer: unknown[] = []
      const enqueueLive = (msg: any) => {
        if (msg && typeof msg === 'object') {
          const t = msg.type
          // SECURITY: operator-only events (internal notes) are broadcast
          // on the shared conversation channel (the operator inbox needs
          // them live), so the visitor stream MUST drop them here. Notes
          // are also a separate table, so no backfill/history path can
          // leak them — this live gate is the only visitor-facing path.
          if (isOperatorOnlyEvent(t)) return
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
      // Drain anything that arrived during subscribe() setup into the
      // live buffer — backfill will dedupe past it.
      for (const msg of pending!) liveBuffer.push(msg)
      pending = null

      onPubsubError = (err) => {
        console.warn('[widget-stream] pubsub error, closing SSE:', err.message)
        try { controller.close() } catch {}
      }

      try {
        controller.enqueue(formatSSE({ type: 'hello', subId, conversationId, resumed: !!resumeFrom }))
      } catch {}

      // Backfill: replay persisted messages the client missed while
      // its EventSource was between connections. We strictly order by
      // (createdAt, id) so ties resolve deterministically — same
      // ordering the resume id implies on the way out.
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
            // Tell the client it should fall back to a full reload —
            // we capped the replay and there are still gaps.
            try {
              controller.enqueue(formatSSE({
                type: 'resume_truncated',
                replayed: toReplay.length,
              }))
            } catch {}
          }
        } catch (err: any) {
          console.warn('[widget-stream] backfill failed:', err?.message)
          // Non-fatal — live tail still works, client just keeps
          // whatever it had locally.
        }
      }

      // Live tail open. Drain anything pubsub delivered during backfill,
      // then flip the switch so subsequent events go straight through.
      // Backfill + live both originate from the canonical DB row, so a
      // message delivered via NOTIFY that we ALSO replayed from DB will
      // arrive twice. The client dedupes by message id (existing
      // behavior in the embed page's onmessage handler).
      for (const msg of liveBuffer) enqueueLive(msg)
      liveBuffer.length = 0
      liveReady = true

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(formatSSE({ type: 'ping', t: Date.now() }))
        } catch {
          clearInterval(heartbeat)
        }
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
      ...cors,
    },
  })
}
