/**
 * Cross-instance pub/sub for chat-widget SSE events, backed by Postgres
 * LISTEN/NOTIFY.
 *
 * Why this exists: the in-memory Map keyed by conversationId worked on a
 * single Vercel function instance, but on multi-instance deployments the
 * visitor's SSE landed on instance A while the agent ran on instance B —
 * so the broadcast on B found an empty map and the message was lost.
 *
 * Connection model:
 *  - publish() goes through Prisma's pool (cheap, short-lived).
 *  - subscribe() shares ONE pg.Client per function instance. The client
 *    LISTENs on a single fan-in channel ("widget_events") and we demux
 *    in-process by conversationId. Earlier the route opened a dedicated
 *    pg.Client per SSE stream — that saturated Postgres direct-connection
 *    limits (Neon caps direct connections aggressively) once a handful
 *    of visitors were chatting concurrently, and any pg-side blip closed
 *    every active stream. Sharing the connection makes widget capacity
 *    bounded by function-instance count, not by visitor count.
 *
 * The shared client is lazy: it opens on the first subscribe(), gets
 * recycled on error so the next subscribe() reconnects, and is held
 * open for the lifetime of the function instance.
 */

import { Client } from 'pg'
import { db } from './db'

const CHANNEL = 'widget_events'

// Postgres has an 8000-byte hard cap on NOTIFY payloads. We refuse
// anything close to that — operator messages and agent replies are far
// smaller in practice (~4KB max for a long agent reply).
const MAX_PAYLOAD_BYTES = 7000

function directConnectionString(): string {
  // LISTEN must run on a connection that won't be returned to a
  // transaction-mode pooler between statements. Vercel Postgres /
  // Neon expose a NON_POOLING URL specifically for this.
  return (
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

function tearDownSharedClient() {
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null }
  const client = sharedClient
  sharedClient = null
  connectPromise = null
  if (client) client.end().catch(() => {})
}

async function getSharedClient(): Promise<Client> {
  if (sharedClient) return sharedClient
  if (connectPromise) return connectPromise
  connectPromise = (async () => {
    const client = new Client({
      connectionString: directConnectionString(),
      ssl: { rejectUnauthorized: false },
    })
    client.on('notification', (n) => {
      if (n.channel !== CHANNEL || !n.payload) return
      let parsed: { c?: string; m?: unknown }
      try { parsed = JSON.parse(n.payload) } catch (err: any) {
        console.warn('[widget-pubsub] malformed notification payload:', err.message)
        return
      }
      const cid = parsed.c
      if (!cid) return
      const handlers = subscribers.get(cid)
      if (!handlers || handlers.size === 0) return
      for (const handler of handlers) {
        try { handler(parsed.m) } catch (err: any) {
          console.warn('[widget-pubsub] subscriber threw:', err.message)
        }
      }
    })
    client.on('error', (err) => {
      console.warn('[widget-pubsub] shared LISTEN connection error:', err.message)
      // Tear down so the next subscribe() reconnects, and notify every
      // active stream so it can close + tell the visitor to retry.
      tearDownSharedClient()
      const allErrorHandlers: ErrorHandler[] = []
      for (const set of errorHandlers.values()) {
        for (const h of set) allErrorHandlers.push(h)
      }
      for (const h of allErrorHandlers) {
        try { h(err) } catch {}
      }
    })
    await client.connect()
    await client.query(`LISTEN ${CHANNEL}`)
    sharedClient = client
    // Idle ping so connection-tracking middleboxes don't reap us during
    // a quiet stretch.
    heartbeat = setInterval(() => {
      client.query('SELECT 1').catch(() => {})
    }, 30_000)
    return client
  })().catch((err) => {
    connectPromise = null
    throw err
  })
  return connectPromise
}

export async function publish(conversationId: string, message: unknown): Promise<void> {
  const payload = JSON.stringify({ c: conversationId, m: message })
  if (Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES) {
    console.warn(`[widget-pubsub] dropping NOTIFY payload — too large (${payload.length} chars)`)
    return
  }
  try {
    await db.$executeRawUnsafe(`NOTIFY ${CHANNEL}, $1`, payload)
  } catch (err: any) {
    console.warn(`[widget-pubsub] NOTIFY failed:`, err.message)
  }
}

export type Subscription = {
  close: () => Promise<void>
}

export async function subscribe(
  conversationId: string,
  handler: Handler,
  onError?: ErrorHandler,
): Promise<Subscription> {
  await getSharedClient()
  let set = subscribers.get(conversationId)
  if (!set) { set = new Set(); subscribers.set(conversationId, set) }
  set.add(handler)
  let errSet: Set<ErrorHandler> | undefined
  if (onError) {
    errSet = errorHandlers.get(conversationId)
    if (!errSet) { errSet = new Set(); errorHandlers.set(conversationId, errSet) }
    errSet.add(onError)
  }
  return {
    close: async () => {
      const s = subscribers.get(conversationId)
      if (s) { s.delete(handler); if (s.size === 0) subscribers.delete(conversationId) }
      if (errSet && onError) {
        const es = errorHandlers.get(conversationId)
        if (es) { es.delete(onError); if (es.size === 0) errorHandlers.delete(conversationId) }
      }
    },
  }
}
