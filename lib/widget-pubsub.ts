/**
 * Cross-instance pub/sub for chat-widget SSE events, backed by Postgres
 * LISTEN/NOTIFY when reachable — graceful in-memory fallback when not.
 *
 * Why this exists: the in-memory Map keyed by conversationId works on a
 * single Vercel function instance. On multi-instance deployments, the
 * visitor's SSE lands on instance A while the agent runs on B — without
 * cross-instance delivery, B's broadcast finds an empty map and the
 * message is lost.
 *
 * Connection model:
 *  - publish() ALWAYS delivers to the in-memory subscriber map first
 *    (so local subscribers get the message even with no DB reachable),
 *    then ATTEMPTS Postgres NOTIFY for cross-instance fan-out. If NOTIFY
 *    has been disabled (DNS failed once), this is a no-op.
 *  - subscribe() ALWAYS registers in the in-memory map. It also tries
 *    to ensure the shared LISTEN connection is open — but never throws
 *    if it can't, because losing cross-instance delivery should NOT
 *    break the SSE stream for the visitor in front of you.
 *  - Cross-instance delivery requires a SESSION-MODE Postgres connection
 *    (LISTEN survives across statements). On Supabase that's the direct
 *    db.<ref>.supabase.co:5432 host, which is IPv6-only on the free
 *    tier and unreachable from Vercel — that's where degradation kicks
 *    in. Setting POSTGRES_URL_SESSION_POOLER (or whichever env var
 *    points at the IPv4-reachable session-mode pooler) restores it.
 *
 * Once a connection attempt fails with a DNS error (ENOTFOUND), pubsub
 * is marked unavailable for FAIL_BACKOFF_MS so we don't hammer DNS on
 * every SSE reconnect. After the backoff, we try again — the env var
 * may have been added in the meantime.
 */

import { Client } from 'pg'
import { db } from './db'

const CHANNEL = 'widget_events'
const MAX_PAYLOAD_BYTES = 7000
const FAIL_BACKOFF_MS = 5 * 60_000 // 5 minutes

function directConnectionString(): string {
  return (
    process.env.POSTGRES_URL_SESSION_POOLER ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.POSTGRES_PRISMA_URL ??
    'postgresql://localhost:5432/ghl_agent'
  )
}

type Handler = (msg: unknown) => void
type ErrorHandler = (err: Error) => void

const subscribers = new Map<string, Set<Handler>>()
const errorHandlers = new Map<string, Set<ErrorHandler>>()

let sharedClient: Client | null = null
let connectPromise: Promise<Client> | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null

// The shared LISTEN client is a SESSION-mode pooler connection, and
// Supavisor counts it against the project-wide client cap (200 on the
// current compute tier) alongside every instance's Prisma pool. An
// instance that served one SSE stream must not pin that connection for
// its whole lifetime — reap it once no subscribers remain, with a short
// linger so visitor reconnects don't churn LISTEN setup.
const IDLE_TEARDOWN_MS = 45_000
let reapTimer: ReturnType<typeof setTimeout> | null = null

function cancelReap() {
  if (reapTimer) {
    clearTimeout(reapTimer)
    reapTimer = null
  }
}

function scheduleReapIfIdle() {
  if (subscribers.size > 0 || !sharedClient) return
  cancelReap()
  reapTimer = setTimeout(() => {
    reapTimer = null
    if (subscribers.size > 0) return
    tearDownSharedClient()
    if (pubsubState === 'available') pubsubState = 'unknown'
  }, IDLE_TEARDOWN_MS)
  reapTimer.unref?.()
}

// Tracks whether cross-instance pubsub is currently attemptable.
// 'unknown'  — never tried, will attempt on first subscribe()
// 'available' — connection open and LISTENing
// 'unavailable' — recent attempt failed; respect FAIL_BACKOFF_MS before retrying
let pubsubState: 'unknown' | 'available' | 'unavailable' = 'unknown'
let pubsubFailedAt = 0
let pubsubFailLogged = false

function deliverInMemory(conversationId: string, message: unknown): void {
  const handlers = subscribers.get(conversationId)
  if (!handlers || handlers.size === 0) return
  for (const handler of handlers) {
    try {
      handler(message)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[widget-pubsub] subscriber threw:', msg)
    }
  }
}

function tearDownSharedClient() {
  if (heartbeat) {
    clearInterval(heartbeat)
    heartbeat = null
  }
  const client = sharedClient
  sharedClient = null
  connectPromise = null
  if (client) client.end().catch(() => {})
}

function markUnavailable(reason: string) {
  pubsubState = 'unavailable'
  pubsubFailedAt = Date.now()
  if (!pubsubFailLogged) {
    console.warn(
      '[widget-pubsub] cross-instance pubsub unavailable — falling back to in-memory only delivery.',
      `reason=${reason}`,
      `(retry after ${FAIL_BACKOFF_MS / 60_000}min)`,
    )
    pubsubFailLogged = true
  }
}

function shouldRetry(): boolean {
  if (pubsubState !== 'unavailable') return true
  if (Date.now() - pubsubFailedAt > FAIL_BACKOFF_MS) {
    pubsubFailLogged = false // allow a fresh log on retry-failure
    return true
  }
  return false
}

/** Try to open the shared LISTEN connection. Returns null on any failure
 *  rather than throwing — callers must treat null as "no cross-instance
 *  pubsub available, in-memory only." */
async function tryGetSharedClient(): Promise<Client | null> {
  if (sharedClient) return sharedClient
  if (!shouldRetry()) return null
  if (connectPromise) {
    return connectPromise.catch(() => null)
  }
  connectPromise = (async () => {
    const client = new Client({
      connectionString: directConnectionString(),
      ssl: { rejectUnauthorized: false },
      // Cap the connect attempt — hung DNS lookups would otherwise hold
      // up the SSE response indefinitely.
      connectionTimeoutMillis: 8_000,
    })
    client.on('notification', (n) => {
      if (n.channel !== CHANNEL || !n.payload) return
      let parsed: { c?: string; m?: unknown; s?: string }
      try {
        parsed = JSON.parse(n.payload)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn('[widget-pubsub] malformed notification payload:', msg)
        return
      }
      const cid = parsed.c
      if (!cid) return
      // Dedup: skip our own broadcasts. publish() already delivered
      // them in-memory directly, so we'd double-deliver if we re-ran
      // them on the round-trip.
      if (parsed.s === SENDER_ID) return
      deliverInMemory(cid, parsed.m)
    })
    client.on('error', (err) => {
      console.warn('[widget-pubsub] shared LISTEN connection error:', err.message)
      tearDownSharedClient()
      markUnavailable(err.message)
      const allErrorHandlers: ErrorHandler[] = []
      for (const set of errorHandlers.values()) {
        for (const h of set) allErrorHandlers.push(h)
      }
      for (const h of allErrorHandlers) {
        try {
          h(err)
        } catch {}
      }
    })
    await client.connect()
    await client.query(`LISTEN ${CHANNEL}`)
    sharedClient = client
    pubsubState = 'available'
    pubsubFailLogged = false
    heartbeat = setInterval(() => {
      client.query('SELECT 1').catch(() => {})
    }, 30_000)
    return client
  })().catch((err) => {
    connectPromise = null
    const msg = err instanceof Error ? err.message : String(err)
    markUnavailable(msg)
    return null
  }) as Promise<Client | null> as Promise<Client>
  return connectPromise.catch(() => null)
}

export async function publish(conversationId: string, message: unknown): Promise<void> {
  // 1. Always deliver in-memory first. If everyone's on this instance,
  //    we're done — no DB needed.
  deliverInMemory(conversationId, message)

  // 2. Best-effort fan-out via NOTIFY. Skip entirely if pubsub is in
  //    backoff. NOTIFY round-trips back to our own LISTEN connection,
  //    but our own subscribers were already delivered above — to avoid
  //    double-delivery we tag the payload with a sender id and have the
  //    receiver skip its own messages.
  if (pubsubState === 'unavailable' && !shouldRetry()) return
  const payload = JSON.stringify({ c: conversationId, m: message, s: SENDER_ID })
  if (Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES) {
    console.warn(`[widget-pubsub] dropping NOTIFY payload — too large (${payload.length} chars)`)
    return
  }
  try {
    // NOTIFY is a Postgres command statement and does NOT accept
    // $-placeholder parameters — that's why a naive
    // `NOTIFY chan, $1` raises "syntax error at or near $1" through
    // Prisma's raw exec. Use the pg_notify() function instead, which
    // IS parameterizable, identical wire semantics on the receiver
    // side (LISTEN clients see the same NotificationResponse).
    await db.$executeRaw`SELECT pg_notify(${CHANNEL}, ${payload})`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // NOTIFY through the Prisma pool can fail independently of LISTEN —
    // log quietly without disabling the whole module.
    console.warn(`[widget-pubsub] NOTIFY failed:`, msg)
  }
}

// Per-instance unique id so we can ignore our own NOTIFY round-trips
// (referenced from publish() and the on('notification') handler in
// tryGetSharedClient — both run after module init so TDZ is fine).
const SENDER_ID = Math.random().toString(36).slice(2, 10)

export type Subscription = {
  close: () => Promise<void>
}

/**
 * Diagnostic snapshot of the cross-instance pubsub state. Surfaced via
 * /api/admin/pubsub-status so operators can verify whether realtime
 * delivery is healthy or silently degraded to in-memory-only.
 *
 * `state === 'unavailable'` means cross-instance fan-out is OFF —
 * publishes from one Vercel function don't reach subscribers on a
 * different function. On Vercel serverless that's most messages.
 * The fix is environment, not code: set POSTGRES_URL_SESSION_POOLER
 * to the Supabase Session-mode pooler URL.
 */
export function getPubsubStatus(): {
  state: 'unknown' | 'available' | 'unavailable'
  inMemorySubscriberCount: number
  failedAtMsAgo: number | null
  connectionStringHost: string | null
  hint: string | null
} {
  let total = 0
  for (const set of subscribers.values()) total += set.size

  const cs = directConnectionString()
  // Surface ONLY the host (not credentials) so the diagnostic is safe
  // to expose. Parsing manually avoids the URL constructor's quirks
  // around the user:pass@host:port format.
  let host: string | null = null
  try {
    const m = cs.match(/@([^/?]+)/)
    host = m?.[1] ?? null
  } catch {}

  let hint: string | null = null
  if (pubsubState === 'unavailable') {
    hint = 'Cross-instance pubsub is OFF. Set POSTGRES_URL_SESSION_POOLER to the Supabase Session-mode pooler URL (Supabase dashboard → Project Settings → Database → Connection pooling → Session, port 5432). Without this, SSE events broadcast on one Vercel function are not delivered to subscribers on a different function — symptoms: widget agent replies stop appearing, inbox doesn\'t show messages live, resolve/jump-in doesn\'t propagate without a refresh.'
  } else if (pubsubState === 'unknown') {
    hint = 'No subscribers have connected yet — open any conversation to trigger a connection attempt and re-check.'
  }

  return {
    state: pubsubState,
    inMemorySubscriberCount: total,
    failedAtMsAgo: pubsubFailedAt ? Date.now() - pubsubFailedAt : null,
    connectionStringHost: host,
    hint,
  }
}

export async function subscribe(
  conversationId: string,
  handler: Handler,
  onError?: ErrorHandler,
): Promise<Subscription> {
  // Register the in-memory subscriber FIRST. This is the only thing that
  // must succeed for the SSE stream to be useful on this instance.
  let set = subscribers.get(conversationId)
  if (!set) {
    set = new Set()
    subscribers.set(conversationId, set)
  }
  set.add(handler)
  cancelReap()
  let errSet: Set<ErrorHandler> | undefined
  if (onError) {
    errSet = errorHandlers.get(conversationId)
    if (!errSet) {
      errSet = new Set()
      errorHandlers.set(conversationId, errSet)
    }
    errSet.add(onError)
  }

  // Best-effort: try to open the shared LISTEN connection so we ALSO
  // receive cross-instance broadcasts. Never throws — null result just
  // means we're in single-instance mode.
  await tryGetSharedClient()

  return {
    close: async () => {
      const s = subscribers.get(conversationId)
      if (s) {
        s.delete(handler)
        if (s.size === 0) subscribers.delete(conversationId)
      }
      if (errSet && onError) {
        const es = errorHandlers.get(conversationId)
        if (es) {
          es.delete(onError)
          if (es.size === 0) errorHandlers.delete(conversationId)
        }
      }
      scheduleReapIfIdle()
    },
  }
}

