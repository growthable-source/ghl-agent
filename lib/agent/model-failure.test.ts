import { describe, it, expect } from 'vitest'
import { classifyLlmFailure, isBillingLapse } from './model-failure'

// The exact body Anthropic returned throughout the 2026-08-11 outage.
const CREDIT_ERROR = {
  status: 400,
  message:
    '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
}

describe('isBillingLapse', () => {
  it('detects the Anthropic credit-balance message', () => {
    expect(isBillingLapse(CREDIT_ERROR)).toBe(true)
  })

  it('detects quota and payment-required phrasing from other providers', () => {
    expect(isBillingLapse({ message: 'quota exceeded for this organization' })).toBe(true)
    expect(isBillingLapse({ message: '402 Payment Required' })).toBe(true)
  })

  it('does NOT treat a genuine bad request as a billing lapse', () => {
    expect(isBillingLapse({ status: 400, message: 'prompt is too long: 250000 tokens' })).toBe(false)
    expect(isBillingLapse({ status: 404, message: 'not_found_error: model' })).toBe(false)
  })
})

describe('classifyLlmFailure', () => {
  // The regression that dropped ~114 customer messages: a spent balance is a
  // non-retryable 4xx by HTTP semantics, but succeeds on retry once funded.
  it('classifies a billing lapse as RETRYABLE so the cron replays it', () => {
    const c = classifyLlmFailure(CREDIT_ERROR, 'claude-sonnet')
    expect(c.retryable).toBe(true)
    expect(c.skipped).toBe('model_unavailable')
    expect(c.detail).toContain('cause=billing_lapse')
  })

  it('still classifies a real bad request as permanent', () => {
    const c = classifyLlmFailure({ status: 400, message: 'prompt is too long' }, 'claude-sonnet')
    expect(c.retryable).toBe(false)
    expect(c.skipped).toBe('model_rejected')
    expect(c.detail).not.toContain('billing_lapse')
  })

  it('records the requested model and status in the detail', () => {
    const c = classifyLlmFailure({ status: 529, message: 'Overloaded' }, 'deepseek-flash')
    expect(c.detail).toContain('status=529')
    expect(c.detail).toContain('model=deepseek-flash')
  })
})
