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
 */
export function formatSSE(event: EventMessage): Uint8Array {
  const json = JSON.stringify(event)
  const frame = `data: ${json}\n\n`
  return new TextEncoder().encode(frame)
}
