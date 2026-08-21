import { describe, it, expect } from 'vitest'
import { buildSentimentPrompt, parseSentiment } from './widget-sentiment'

describe('buildSentimentPrompt', () => {
  it('judges the CUSTOMER conduct and lists the three levels', () => {
    const { system, user } = buildSentimentPrompt('CUSTOMER: this is useless, you idiot')
    expect(system.toUpperCase()).toContain('GREEN')
    expect(system.toUpperCase()).toContain('AMBER')
    expect(system.toUpperCase()).toContain('RED')
    expect(system.toLowerCase()).toMatch(/customer|visitor/)
    expect(user).toContain('this is useless')
  })
})

describe('parseSentiment', () => {
  it('parses the LEVEL | REASON line', () => {
    expect(parseSentiment('LEVEL: RED | REASON: insulted the agent')).toEqual({
      level: 'red', reason: 'insulted the agent',
    })
    expect(parseSentiment('LEVEL: GREEN | REASON: polite and clear')).toEqual({
      level: 'green', reason: 'polite and clear',
    })
  })

  it('is case-insensitive and trims', () => {
    expect(parseSentiment('level: amber | reason:  a bit frustrated  ')).toEqual({
      level: 'amber', reason: 'a bit frustrated',
    })
  })

  it('falls back to a bare level keyword', () => {
    expect(parseSentiment('This looks RED to me')?.level).toBe('red')
    expect(parseSentiment('AMBER')?.level).toBe('amber')
  })

  it('returns null on garbage', () => {
    expect(parseSentiment('')).toBeNull()
    expect(parseSentiment('no idea')).toBeNull()
  })

  it('does not misread green when red is also present', () => {
    // "red" wins when both appear (worst-case bias for safety surfacing).
    expect(parseSentiment('not green, more RED')?.level).toBe('red')
  })

  it('does not trip RED on -red-ending words in the fallback', () => {
    // "answered"/"offered"/"delivered" contain "red" but are not the word RED.
    expect(parseSentiment('the customer answered politely and offered thanks — green')?.level).toBe('green')
    expect(parseSentiment('order was delivered, considered fine')).toBeNull()
  })
})
