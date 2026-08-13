/**
 * Classify a thrown LLM-call failure into a skip reason the inbound
 * pipeline can act on.
 *
 * Every exception out of the provider call used to collapse into a single
 * `model_unavailable` skip with the copy "model provider unavailable" and a
 * page to a human. That conflated two very different failures:
 *
 *   - TRANSIENT (429 / 529 overloaded / network / timeout): the provider was
 *     up-and-down. A later attempt is likely to succeed → `model_unavailable`,
 *     which is RETRYABLE out-of-band.
 *   - PERMANENT (non-retryable 4xx — 400 bad request / context too long, 401
 *     bad key, 404 model not found): the request itself was rejected. Retrying
 *     fails identically → `model_rejected`, which must be paged immediately;
 *     no cron retry will ever fix it.
 *
 * We reuse the exact retryability rule the in-call retry loop uses
 * (`isRetryableAnthropicError`) so "did we keep retrying?" and "is this
 * skip retryable out-of-band?" can never disagree.
 */

import { isRetryableAnthropicError } from '../anthropic-resilient'

/**
 * A spent credit balance / exceeded billing cap arrives as a NON-retryable
 * 4xx, so the rule above would file it as permanent and never retry it. That
 * is wrong in the only sense that matters: the request was fine, the account
 * was temporarily unfunded, and the identical request succeeds the moment
 * somebody tops up.
 *
 * Filing it as permanent cost real customer messages — during the 2026-08-11
 * outage ~114 inbounds were classified `model_rejected`, dropped, and never
 * revisited even after billing was restored. Treat it as transient so the
 * retry cron replays them on its own; the operator is still paged, because
 * `model_unavailable` that persists is exactly what the fleet health check
 * escalates on.
 */
export function isBillingLapse(err: unknown): boolean {
  const e = err as { message?: string; error?: unknown } | null
  const msg = `${e?.message ?? ''} ${typeof e?.error === 'string' ? e.error : JSON.stringify(e?.error ?? '')}`
  return /credit balance is too low|billing|quota|insufficient[_ ]funds|payment required/i.test(msg)
}

export interface ClassifiedLlmFailure {
  /** Skip reason the agent loop returns. */
  skipped: 'model_unavailable' | 'model_rejected'
  /** True for transient provider failures eligible for out-of-band retry. */
  retryable: boolean
  /** Compact diagnostic persisted into MessageLog.errorMessage so a 529
   *  outage is distinguishable from a permanent 4xx after the fact. */
  detail: string
}

export function classifyLlmFailure(err: unknown, requestedModel?: string | null): ClassifiedLlmFailure {
  const billing = isBillingLapse(err)
  const retryable = billing || isRetryableAnthropicError(err)
  const status = (err as { status?: unknown })?.status ?? 'network'
  return {
    skipped: retryable ? 'model_unavailable' : 'model_rejected',
    retryable,
    detail:
      `status=${String(status)} model=${requestedModel || 'auto'} retryable=${retryable}` +
      (billing ? ' cause=billing_lapse' : ''),
  }
}
