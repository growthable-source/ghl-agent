/**
 * runAgent returns `{ reply: null, skipped: <reason> }` when it produced no
 * reply at all. Some skip reasons are *transient infrastructure failures*
 * (the model provider was unreachable, overloaded, or out of credit) — the
 * inbound went genuinely UNANSWERED and a human needs to know.
 *
 * Historically these skips fell through and were stamped `MessageLog.status
 * = 'SUCCESS'` with a null reply, so a billing/overload blip silently
 * dropped a customer's message with no error and no notification, while the
 * inbox kept showing "Autopilot will reply". This helper is the single
 * source of truth for "this skip means the message was left unanswered and
 * must be surfaced, not recorded as a success".
 *
 * Intentional skips (e.g. the agent deliberately stayed quiet) are NOT in
 * this set — only failures where we WANTED to reply but couldn't.
 */
export const UNANSWERED_SKIP_REASONS = ['model_unavailable'] as const

export type UnansweredSkipReason = (typeof UNANSWERED_SKIP_REASONS)[number]

/**
 * True when a runAgent `skipped` value represents an inbound that was left
 * unanswered due to a transient failure and must be surfaced as an error
 * (logged + operator notified), never recorded as a successful reply.
 */
export function isUnansweredSkip(skip: string | null | undefined): skip is UnansweredSkipReason {
  return !!skip && (UNANSWERED_SKIP_REASONS as readonly string[]).includes(skip)
}
