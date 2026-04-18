/**
 * In-memory SSE connection registry for chat widget conversations.
 *
 * When a visitor opens the widget, the browser establishes a long-lived
 * GET to /api/widget/.../stream that returns text/event-stream. We hold
 * that response's WritableStream controller here, keyed by conversationId,
 * so that the agent reply path can push events to it.
 *
 * ⚠ This is a single-instance in-memory registry. It works fine on one
 * Vercel serverless function instance. For multi-instance production
 * deployment, swap this for Redis pub/sub or similar.
 */

type EventMessage = {
  type: string
  [k: string]: unknown
}

type Subscriber = {
  id: string
  write: (msg: EventMessage) => void
  close: () => void
}

// Global singleton — survives module re-evaluation in dev
const g = globalThis as any
if (!g.__voxility_widget_subs) {
  g.__voxility_widget_subs = new Map<string, Set<Subscriber>>()
}
const subscribers: Map<string, Set<Subscriber>> = g.__voxility_widget_subs

export function addSubscriber(conversationId: string, subscriber: Subscriber) {
  if (!subscribers.has(conversationId)) subscribers.set(conversationId, new Set())
  subscribers.get(conversationId)!.add(subscriber)
}

export function removeSubscriber(conversationId: string, subscriber: Subscriber) {
  const set = subscribers.get(conversationId)
  if (!set) return
  set.delete(subscriber)
  if (set.size === 0) subscribers.delete(conversationId)
}

export function broadcast(conversationId: string, message: EventMessage) {
  const set = subscribers.get(conversationId)
  if (!set) return
  for (const sub of set) {
    try {
      sub.write(message)
    } catch (err: any) {
      console.warn(`[widget-sse] broadcast failed for sub ${sub.id}:`, err.message)
    }
  }
}

/**
 * Format a single SSE event frame. Returns a string already encoded
 * as bytes in UTF-8.
 */
export function formatSSE(event: EventMessage): Uint8Array {
  const json = JSON.stringify(event)
  const frame = `data: ${json}\n\n`
  return new TextEncoder().encode(frame)
}

export function activeSubscriberCount(conversationId: string): number {
  return subscribers.get(conversationId)?.size ?? 0
}
