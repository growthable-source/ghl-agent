/**
 * Single source of truth for what an operator sees when an inbound went
 * unanswered because the LLM call failed.
 *
 * Both inbound pipelines (the CRM marketplace webhook and the native-channel
 * handler) call this so the MessageLog error text and the operator
 * notification are identical and — critically — HONEST about which failure
 * occurred:
 *
 *   - model_unavailable (transient): the provider was briefly unavailable.
 *     Recoverable; eligible for out-of-band retry.
 *   - model_rejected (permanent): the provider rejected the request itself
 *     (bad request / context too long / auth). A human must intervene; no
 *     retry will fix it.
 *
 * The raw status+model `skipDetail` is folded into the persisted error so the
 * two are distinguishable after the fact, since Vercel console logs are
 * ephemeral.
 */

import { isRetryableSkip } from './reply-skip'

export interface UnansweredSkipNotice {
  /** Persisted into MessageLog.errorMessage (≤500 chars at call sites). */
  errorMessage: string
  /** Operator notification title. */
  notifyTitle: string
  /** Operator notification body. */
  notifyBody: string
  severity: 'error'
  /** True when this skip is transient and eligible for out-of-band retry. */
  retryable: boolean
}

export function describeUnansweredSkip(args: {
  agentName: string
  inboundMessage: string
  skipped: string
  skipDetail?: string | null
}): UnansweredSkipNotice {
  const { agentName, inboundMessage, skipped, skipDetail } = args
  const retryable = isRetryableSkip(skipped)
  const detail = skipDetail ? ` [${skipDetail}]` : ''
  const snippet = inboundMessage.slice(0, 120)

  if (retryable) {
    return {
      errorMessage: `Agent produced no reply — ${skipped}: the AI model was temporarily unavailable${detail}`,
      notifyTitle: `${agentName}: model temporarily unavailable`,
      notifyBody: `The AI model was briefly unavailable, so "${snippet}" is waiting for a human to take over.`,
      severity: 'error',
      retryable: true,
    }
  }

  return {
    errorMessage: `Agent produced no reply — ${skipped}: the AI model rejected the request${detail}`,
    notifyTitle: `${agentName}: model rejected the request`,
    notifyBody: `The AI model rejected "${snippet}"${skipDetail ? ` (${skipDetail})` : ''}. This needs attention — it won't resolve on its own.`,
    severity: 'error',
    retryable: false,
  }
}
