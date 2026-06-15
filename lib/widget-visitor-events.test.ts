import { describe, it, expect } from 'vitest'
import { isOperatorOnlyEvent } from './widget-visitor-events'

describe('isOperatorOnlyEvent', () => {
  it('flags internal notes as operator-only (never sent to visitors)', () => {
    expect(isOperatorOnlyEvent('internal_note')).toBe(true)
  })
  it('allows the events visitors must receive', () => {
    for (const t of ['agent_message', 'visitor_message', 'agent_typing', 'status_changed', 'ping', 'hello']) {
      expect(isOperatorOnlyEvent(t)).toBe(false)
    }
  })
  it('is safe against non-string input', () => {
    expect(isOperatorOnlyEvent(undefined)).toBe(false)
    expect(isOperatorOnlyEvent(null)).toBe(false)
    expect(isOperatorOnlyEvent(42)).toBe(false)
  })
})
