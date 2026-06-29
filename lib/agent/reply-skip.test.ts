import { describe, it, expect } from 'vitest'
import { isUnansweredSkip, isRetryableSkip } from './reply-skip'

describe('isUnansweredSkip', () => {
  it('flags model_unavailable — the transient provider failure that left the message unanswered', () => {
    // Regression: an out-of-credit / overloaded Anthropic response made
    // runAgent return { reply: null, skipped: 'model_unavailable' }, which
    // used to be stamped MessageLog SUCCESS and silently dropped.
    expect(isUnansweredSkip('model_unavailable')).toBe(true)
  })

  it('flags model_rejected — a permanent 4xx that also left the message unanswered', () => {
    // A 400/401/404 from the provider produces no reply too; it must surface
    // as an error (not SUCCESS), even though it is NOT retryable.
    expect(isUnansweredSkip('model_rejected')).toBe(true)
  })

  it('does not flag a normal completed run (no skip)', () => {
    expect(isUnansweredSkip(undefined)).toBe(false)
    expect(isUnansweredSkip(null)).toBe(false)
    expect(isUnansweredSkip('')).toBe(false)
  })

  it('does not flag unrelated skip reasons — preserves existing behaviour', () => {
    // e.g. broken_references is handled by its own runtime fallback; we do
    // not want to change its semantics here.
    expect(isUnansweredSkip('broken_references')).toBe(false)
    expect(isUnansweredSkip('something_else')).toBe(false)
  })
})

describe('isRetryableSkip', () => {
  it('flags model_unavailable as retryable out-of-band', () => {
    expect(isRetryableSkip('model_unavailable')).toBe(true)
  })

  it('does NOT flag model_rejected — a permanent 4xx fails identically on retry', () => {
    expect(isRetryableSkip('model_rejected')).toBe(false)
  })

  it('does not flag non-skip / unrelated values', () => {
    expect(isRetryableSkip(undefined)).toBe(false)
    expect(isRetryableSkip(null)).toBe(false)
    expect(isRetryableSkip('broken_references')).toBe(false)
  })
})
