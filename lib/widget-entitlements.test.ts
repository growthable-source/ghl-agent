import { describe, expect, it } from 'vitest'
import {
  NO_HANDOFF_DIRECTIVE,
  noAgentFallback,
  planAllowsHumanHandoff,
  silentAgentFallback,
} from './widget-entitlements'

describe('planAllowsHumanHandoff', () => {
  it('grants handoff to every paid tier', () => {
    expect(planAllowsHumanHandoff('starter')).toBe(true)
    expect(planAllowsHumanHandoff('growth')).toBe(true)
    expect(planAllowsHumanHandoff('scale')).toBe(true)
  })

  it('denies handoff on trial and free — the paid-only rule', () => {
    expect(planAllowsHumanHandoff('trial')).toBe(false)
    expect(planAllowsHumanHandoff('free')).toBe(false)
  })

  it('denies an unknown plan string rather than granting a paid feature by typo', () => {
    expect(planAllowsHumanHandoff('enterprise')).toBe(false)
    expect(planAllowsHumanHandoff('')).toBe(false)
  })
})

describe('visitor-facing fallback copy', () => {
  it('only promises a human when one can actually come', () => {
    // The trial lines must not mention the team: a promised follow-up
    // nobody will make is the exact failure this gate exists to prevent.
    expect(silentAgentFallback(true)).toMatch(/someone on our team/)
    expect(silentAgentFallback(false)).not.toMatch(/team|someone|follow up/i)
    expect(noAgentFallback(true)).toMatch(/our team/)
    expect(noAgentFallback(false)).not.toMatch(/team|someone|shortly/i)
  })
})

describe('NO_HANDOFF_DIRECTIVE', () => {
  it('overrides earlier prompt instructions explicitly', () => {
    // Stored prompts (partner provisioning included) say "hand off to a
    // human"; the directive only works if it claims the last word.
    expect(NO_HANDOFF_DIRECTIVE).toMatch(/overrides any earlier instruction/i)
  })

  it('forbids both the offer and the promise', () => {
    expect(NO_HANDOFF_DIRECTIVE).toMatch(/never offer/i)
    expect(NO_HANDOFF_DIRECTIVE).toMatch(/never promise/i)
  })
})
