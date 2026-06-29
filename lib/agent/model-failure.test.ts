import { describe, it, expect } from 'vitest'
import { classifyLlmFailure } from './model-failure'

describe('classifyLlmFailure', () => {
  it('classifies a 529 overloaded as transient → model_unavailable (retryable)', () => {
    const c = classifyLlmFailure({ status: 529, message: 'Overloaded' }, 'claude-sonnet')
    expect(c.skipped).toBe('model_unavailable')
    expect(c.retryable).toBe(true)
    expect(c.detail).toContain('status=529')
    expect(c.detail).toContain('model=claude-sonnet')
  })

  it('classifies a 429 rate limit as transient → model_unavailable (retryable)', () => {
    const c = classifyLlmFailure({ status: 429 }, 'claude-haiku')
    expect(c.skipped).toBe('model_unavailable')
    expect(c.retryable).toBe(true)
  })

  it('classifies a network/timeout error (no status) as transient → model_unavailable', () => {
    const c = classifyLlmFailure({ message: 'fetch failed: ETIMEDOUT' })
    expect(c.skipped).toBe('model_unavailable')
    expect(c.retryable).toBe(true)
    // No model supplied → defaults to the logical "auto" key.
    expect(c.detail).toContain('model=auto')
  })

  it('classifies a 400 bad request as permanent → model_rejected (NOT retryable)', () => {
    // e.g. context length exceeded for a long conversation — retrying fails
    // identically, so this must page immediately, never enter the retry cron.
    const c = classifyLlmFailure({ status: 400, message: 'prompt is too long' }, 'claude-sonnet')
    expect(c.skipped).toBe('model_rejected')
    expect(c.retryable).toBe(false)
    expect(c.detail).toContain('status=400')
  })

  it('classifies a 401 auth failure as permanent → model_rejected', () => {
    const c = classifyLlmFailure({ status: 401, message: 'invalid x-api-key' }, 'claude-sonnet')
    expect(c.skipped).toBe('model_rejected')
    expect(c.retryable).toBe(false)
  })
})
