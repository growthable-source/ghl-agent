/**
 * Resilient Anthropic Messages calls.
 *
 * The agent loop calls Anthropic in the hot path of every inbound
 * customer message. A bare `client.messages.create()` means a 429
 * (rate limit), 529 (overloaded), or transient network error throws
 * straight out of the loop — the webhook handler 500s, the visitor
 * gets silence, and nothing retries. Anthropic overload is common
 * enough that "one blip = a dropped customer" is a real reliability
 * tax.
 *
 * This wraps create() with bounded exponential backoff on the
 * specifically retryable failures (429, 5xx, network/timeout) and
 * leaves genuine 4xx (bad request, auth) to throw immediately —
 * retrying those just wastes time. Jitter avoids a thundering herd
 * when the whole fleet hits the same rate limit.
 *
 * Callers still get a throw if every attempt fails; the agent runner
 * catches that and degrades to an honest "try again shortly" rather
 * than a silent 500 (see lib/ai-agent.ts).
 */

import type Anthropic from '@anthropic-ai/sdk'

const MAX_ATTEMPTS = 3
const BASE_DELAY_MS = 800

interface RetryableError {
  status?: number
  name?: string
  message?: string
}

export function isRetryableAnthropicError(err: unknown): boolean {
  const e = err as RetryableError
  const status = e?.status
  if (status === 429) return true
  if (typeof status === 'number' && status >= 500) return true
  // SDK surfaces connection problems as APIConnectionError / timeouts
  // with no HTTP status.
  if (status === undefined && /timeout|ECONNRESET|ETIMEDOUT|fetch failed|network|socket hang/i.test(e?.message ?? '')) {
    return true
  }
  if (/APIConnectionError|APIConnectionTimeoutError/i.test(e?.name ?? '')) return true
  return false
}

/** Deterministic-ish jittered backoff. No Math.random dependency in
 *  callers' control flow — jitter derived from the attempt index. */
function backoffMs(attempt: number): number {
  const base = BASE_DELAY_MS * 2 ** attempt
  const jitter = (attempt * 137) % 250 // 0–249ms, varies per attempt
  return base + jitter
}

type CreateParams = Anthropic.Messages.MessageCreateParamsNonStreaming
type CreateResult = Anthropic.Messages.Message

export async function createMessageWithRetry(
  client: Anthropic,
  params: CreateParams,
): Promise<CreateResult> {
  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return (await client.messages.create(params)) as CreateResult
    } catch (err) {
      lastErr = err
      if (attempt === MAX_ATTEMPTS - 1 || !isRetryableAnthropicError(err)) throw err
      const delay = backoffMs(attempt)
      const status = (err as RetryableError)?.status ?? 'network'
      console.warn(`[anthropic] retryable error (${status}), attempt ${attempt + 1}/${MAX_ATTEMPTS}, backing off ${delay}ms`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastErr
}
