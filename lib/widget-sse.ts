/**
 * Public surface for widget SSE event broadcasting.
 *
 * Cross-instance delivery is handled by lib/widget-pubsub.ts using
 * Postgres LISTEN/NOTIFY. This module is now a thin shim that exposes
 * the previous broadcast() and formatSSE() helpers so the existing
 * call sites don't have to change.
 *
 * Stream routes that hold the visitor's SSE connection should use
 * `subscribe()` from widget-pubsub.ts directly instead of the old
 * addSubscriber/removeSubscriber pair.
 */

import { publish } from './widget-pubsub'

export type EventMessage = {
  type: string
  [k: string]: unknown
}

/**
 * Publish an event to every SSE stream listening on this conversation,
 * across all serverless instances. Async because it round-trips through
 * Postgres NOTIFY — await it from request handlers that need the event
 * to land before the function suspends.
 */
export async function broadcast(conversationId: string, message: EventMessage): Promise<void> {
  await publish(conversationId, message)
}

/**
 * Format a single SSE event frame as bytes. Streams enqueue the result
 * directly into their controller.
 *
 * Pass `id` for events the client must be able to resume past on
 * reconnect. The browser stores the last `id:` it saw and replays it
 * back as the `Last-Event-ID` header on the next connect, which lets
 * the server backfill any messages that were broadcast while the
 * EventSource was between connections.
 *
 * Resume IDs must be ASCII-safe: SSE spec disallows newlines in id
 * lines and quietly truncates at the first one.
 */
export function formatSSE(event: EventMessage, opts?: { id?: string }): Uint8Array {
  const json = JSON.stringify(event)
  const idLine = opts?.id ? `id: ${opts.id}\n` : ''
  const frame = `${idLine}data: ${json}\n\n`
  return new TextEncoder().encode(frame)
}

/**
 * Build the resume id we attach to persistable widget messages.
 * `<isoCreatedAt>|<messageId>` — timestamp drives ordering, message id
 * disambiguates ties (two messages persisted in the same millisecond
 * still get distinct ids without needing a sequence column).
 */
export function buildResumeId(createdAt: string | Date, messageId: string): string {
  const iso = typeof createdAt === 'string' ? createdAt : createdAt.toISOString()
  return `${iso}|${messageId}`
}

/**
 * Parse a resume id back into its components. Returns null on
 * malformed input — caller should treat that as "no resume".
 */
export function parseResumeId(raw: string | null | undefined): { createdAt: Date; messageId: string } | null {
  if (!raw) return null
  const idx = raw.indexOf('|')
  if (idx < 0) return null
  const iso = raw.slice(0, idx)
  const messageId = raw.slice(idx + 1)
  const ts = new Date(iso)
  if (Number.isNaN(ts.getTime()) || !messageId) return null
  return { createdAt: ts, messageId }
}
