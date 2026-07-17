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
export const UNANSWERED_SKIP_REASONS = ['model_unavailable', 'model_rejected', 'wall_clock_budget'] as const

export type UnansweredSkipReason = (typeof UNANSWERED_SKIP_REASONS)[number]

/**
 * The subset of unanswered skips that are TRANSIENT and worth retrying
 * out-of-band: the provider was overloaded / unreachable (429 / 5xx /
 * network), so a later attempt is likely to succeed. `model_rejected`
 * (a non-retryable 4xx — bad request, auth, model-not-found) is deliberately
 * excluded: it fails identically on retry, so it must be paged immediately
 * rather than looped through the retry cron.
 *
 * 'wall_clock_budget' is retryable: the loop bailed because the provider was
 * slow or the tool chain ran long — a later attempt starts with a fresh
 * budget and a warm cache, so it usually succeeds.
 */
export const RETRYABLE_SKIP_REASONS = ['model_unavailable', 'wall_clock_budget'] as const

export type RetryableSkipReason = (typeof RETRYABLE_SKIP_REASONS)[number]

/**
 * True when a runAgent `skipped` value represents an inbound that was left
 * unanswered due to an infrastructure failure and must be surfaced as an
 * error (logged + operator notified), never recorded as a successful reply.
 */
export function isUnansweredSkip(skip: string | null | undefined): skip is UnansweredSkipReason {
  return !!skip && (UNANSWERED_SKIP_REASONS as readonly string[]).includes(skip)
}

/**
 * True when an unanswered skip is transient and safe to retry out-of-band.
 * Used by the retry cron to pick eligible rows and by the inbound paths to
 * decide "schedule a retry" vs "page a human now".
 */
export function isRetryableSkip(skip: string | null | undefined): skip is RetryableSkipReason {
  return !!skip && (RETRYABLE_SKIP_REASONS as readonly string[]).includes(skip)
}
