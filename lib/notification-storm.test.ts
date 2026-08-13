import { describe, it, expect, beforeEach } from 'vitest'
import { isStormSuppressed, resetStormControl, STORM_WINDOW_MS } from './notification-storm'

const T0 = 1_700_000_000_000

beforeEach(() => resetStormControl())

describe('isStormSuppressed', () => {
  it('lets the first alert through and drops repeats in the window', () => {
    expect(isStormSuppressed('agent_error', 'ws1', undefined, T0)).toBe(false)
    expect(isStormSuppressed('agent_error', 'ws1', undefined, T0 + 1_000)).toBe(true)
    expect(isStormSuppressed('agent_error', 'ws1', undefined, T0 + STORM_WINDOW_MS - 1)).toBe(true)
  })

  it('lets another alert through once the window has passed', () => {
    expect(isStormSuppressed('agent_error', 'ws1', undefined, T0)).toBe(false)
    expect(isStormSuppressed('agent_error', 'ws1', undefined, T0 + STORM_WINDOW_MS + 1)).toBe(false)
  })

  // A platform-wide fault hits every tenant at once; suppressing tenant B
  // because tenant A was just told would hide the fault from B entirely.
  it('tracks workspaces independently', () => {
    expect(isStormSuppressed('agent_error', 'ws1', undefined, T0)).toBe(false)
    expect(isStormSuppressed('agent_error', 'ws2', undefined, T0)).toBe(false)
    expect(isStormSuppressed('agent_error', 'ws2', undefined, T0 + 1_000)).toBe(true)
  })

  it('tracks personal alerts separately from workspace-wide ones', () => {
    expect(isStormSuppressed('agent_error', 'ws1', undefined, T0)).toBe(false)
    expect(isStormSuppressed('agent_error', 'ws1', 'user-a', T0)).toBe(false)
    expect(isStormSuppressed('agent_error', 'ws1', 'user-a', T0 + 1_000)).toBe(true)
  })

  // Conversation-level events must never be throttled: two visitors asking
  // for a human are two things a human genuinely has to see.
  it('never suppresses conversation-level events', () => {
    for (const event of ['human_handover', 'needs_attention', 'widget.new_conversation', 'approval_pending']) {
      expect(isStormSuppressed(event, 'ws1', undefined, T0)).toBe(false)
      expect(isStormSuppressed(event, 'ws1', undefined, T0 + 1)).toBe(false)
    }
  })
})
