/**
 * Cross-instance pub/sub for chat-widget SSE events, backed by Postgres
 * LISTEN/NOTIFY.
 *
 * Why this exists: the previous implementation kept subscribers in an
 * in-memory Map keyed by conversationId. That works on a single Vercel
 * function instance, but on multi-instance deployments the visitor's
 * SSE connection lands on instance A while the agent's reply runs on
 * instance B — so the broadcast from B finds an empty map and the
 * message is lost silently. Visitors saw the agent "go quiet."
 *
 * LISTEN/NOTIFY fixes this without adding new infra: NOTIFY can be
 * issued from any pooled connection, every Postgres backend receives
 * the event, and our LISTEN-side connections forward it to whatever
 * SSE streams they're holding open.
 *
 * Connection model:
 *  - publish() goes through the regular Prisma pool (cheap, short-lived).
 *  - subscribe() opens a dedicated `pg.Client` per SSE stream because
 *    LISTEN requires the connection to stay alive between queries —
 *    a transaction-mode pooler would yank it back. We prefer the
 *    NON_POOLING URL when one is configured.
 */

import { Client } from 'pg'
import { db } from './db'

const CHANNEL_PREFIX = 'widget_'

// Postgres has an 8000-byte hard cap on NOTIFY payloads. We refuse
// anything close to that — operator messages and agent replies are far
// smaller than this in practice (~4KB max for a long agent reply).
const MAX_PAYLOAD_BYTES = 7000

function channelName(conversationId: string): string {
  // Postgres identifiers: letters/digits/underscores, max 63 bytes.
  // Conversation IDs are CUIDs which are already lowercase
  // alphanumeric, but we sanitize defensively in case the ID format
  // ever changes.
  const safe = conversationId.toLowerCase().replace(/[^a-z0-9_]/g, '_')
  return `${CHANNEL_PREFIX}${safe}`.slice(0, 63)
}

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

export async function publish(conversationId: string, message: unknown): Promise<void> {
  const channel = channelName(conversationId)
  const payload = JSON.stringify(message)
  if (Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES) {
    console.warn(`[widget-pubsub] dropping NOTIFY payload — too large (${payload.length} chars)`)
    return
  }
  // Channel name can't be parameterized in NOTIFY; we sanitize above
  // so it's safe. Payload IS parameterized.
  try {
    await db.$executeRawUnsafe(`NOTIFY ${channel}, $1`, payload)
  } catch (err: any) {
    console.warn(`[widget-pubsub] NOTIFY failed for ${channel}:`, err.message)
  }
}

export type Subscription = {
  close: () => Promise<void>
}

export async function subscribe(
  conversationId: string,
  handler: (msg: unknown) => void,
  onError?: (err: Error) => void,
): Promise<Subscription> {
  const channel = channelName(conversationId)
  const client = new Client({
    connectionString: directConnectionString(),
    ssl: { rejectUnauthorized: false },
  })

  client.on('notification', (n) => {
    if (n.channel !== channel || !n.payload) return
    try {
      handler(JSON.parse(n.payload))
    } catch (err: any) {
      console.warn('[widget-pubsub] malformed notification payload:', err.message)
    }
  })
  client.on('error', (err) => {
    console.warn(`[widget-pubsub] listener error on ${channel}:`, err.message)
    onError?.(err)
  })

  await client.connect()
  await client.query(`LISTEN ${channel}`)

  return {
    close: async () => {
      try { await client.query(`UNLISTEN ${channel}`) } catch {}
      try { await client.end() } catch {}
    },
  }
}
