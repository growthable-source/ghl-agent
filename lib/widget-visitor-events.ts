/**
 * SSE event types that must NEVER reach the visitor's widget stream —
 * they're operator-only. The visitor and operator both subscribe to the
 * same per-conversation channel, so the visitor stream route gates every
 * event through this predicate before enqueuing it.
 *
 * Internal notes are also stored in a separate table (ConversationNote)
 * the visitor never queries, so this live gate is the single visitor-
 * facing path that could leak one — keep it airtight.
 */
const OPERATOR_ONLY_EVENT_TYPES = new Set<string>(['internal_note'])

export function isOperatorOnlyEvent(type: unknown): boolean {
  return typeof type === 'string' && OPERATOR_ONLY_EVENT_TYPES.has(type)
}
