import { describe, it, expect } from 'vitest'
import { isRetryableAnthropicError } from './anthropic-resilient'

describe('isRetryableAnthropicError', () => {
  it('retries rate limits and server errors', () => {
    expect(isRetryableAnthropicError({ status: 429 })).toBe(true)
    expect(isRetryableAnthropicError({ status: 500 })).toBe(true)
    expect(isRetryableAnthropicError({ status: 503 })).toBe(true)
    expect(isRetryableAnthropicError({ status: 529 })).toBe(true) // Anthropic "overloaded"
  })

  it('does NOT retry genuine client errors', () => {
    expect(isRetryableAnthropicError({ status: 400 })).toBe(false) // bad request
    expect(isRetryableAnthropicError({ status: 401 })).toBe(false) // auth
    expect(isRetryableAnthropicError({ status: 404 })).toBe(false)
    expect(isRetryableAnthropicError({ status: 422 })).toBe(false)
  })

  it('retries network/timeout errors with no HTTP status', () => {
    expect(isRetryableAnthropicError({ message: 'fetch failed' })).toBe(true)
    expect(isRetryableAnthropicError({ message: 'connect ETIMEDOUT' })).toBe(true)
    expect(isRetryableAnthropicError({ message: 'socket hang up' })).toBe(true)
    expect(isRetryableAnthropicError({ name: 'APIConnectionError' })).toBe(true)
  })

  it('does not retry an unknown error with a status but no signal', () => {
    expect(isRetryableAnthropicError({ status: 418 })).toBe(false)
    expect(isRetryableAnthropicError({})).toBe(false)
    expect(isRetryableAnthropicError(null)).toBe(false)
  })
})
