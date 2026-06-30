import { describe, it, expect } from 'vitest'
import { isModelNotFound } from './index'

describe('isModelNotFound', () => {
  it('detects a 404 status (retired / mistyped model id)', () => {
    expect(isModelNotFound({ status: 404, message: 'Not Found' })).toBe(true)
  })

  it('detects Anthropic not_found_error by message', () => {
    expect(isModelNotFound({ message: 'not_found_error: model: claude-sonnet-4-20250514' })).toBe(true)
  })

  it('detects "model ... is not supported" copy', () => {
    expect(isModelNotFound({ message: "model 'claude-sonnet-4-20250514' is not supported" })).toBe(true)
  })

  it('does NOT treat a 429 / overload / network as model-not-found', () => {
    expect(isModelNotFound({ status: 429, message: 'rate limited' })).toBe(false)
    expect(isModelNotFound({ status: 529, message: 'Overloaded' })).toBe(false)
    expect(isModelNotFound({ message: 'fetch failed: ETIMEDOUT' })).toBe(false)
  })

  it('does NOT treat a generic 400 as model-not-found', () => {
    expect(isModelNotFound({ status: 400, message: 'prompt is too long' })).toBe(false)
  })
})
