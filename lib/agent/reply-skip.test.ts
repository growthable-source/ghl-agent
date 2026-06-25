import { describe, it, expect } from 'vitest'
import { isUnansweredSkip } from './reply-skip'

describe('isUnansweredSkip', () => {
  it('flags model_unavailable — the transient provider failure that left the message unanswered', () => {
    // Regression: an out-of-credit / overloaded Anthropic response made
    // runAgent return { reply: null, skipped: 'model_unavailable' }, which
    // used to be stamped MessageLog SUCCESS and silently dropped.
    expect(isUnansweredSkip('model_unavailable')).toBe(true)
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
