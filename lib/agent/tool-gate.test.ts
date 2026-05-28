import { describe, it, expect } from 'vitest'
import { parseGateResponse } from './tool-gate'

describe('parseGateResponse', () => {
  it('parses an ALLOW response with reason', () => {
    expect(parseGateResponse('ALLOW: Contact picked the 3pm slot.')).toEqual({
      allowed: true,
      reason: 'Contact picked the 3pm slot.',
    })
  })

  it('parses a BLOCK response with reason', () => {
    expect(parseGateResponse('BLOCK: Contact has not picked a specific slot yet.')).toEqual({
      allowed: false,
      reason: 'Contact has not picked a specific slot yet.',
    })
  })

  it('handles leading whitespace and case variants', () => {
    expect(parseGateResponse('  allow: ok').allowed).toBe(true)
    expect(parseGateResponse('\nBLOCK: missing details').allowed).toBe(false)
  })

  it('fails open on unparseable response', () => {
    const r = parseGateResponse('Sure, sounds good!')
    expect(r.allowed).toBe(true)
    expect(r.reason).toMatch(/parse_failure/)
  })

  it('handles ALLOW with no colon', () => {
    expect(parseGateResponse('ALLOW').allowed).toBe(true)
    expect(parseGateResponse('ALLOW').reason).toBe('allowed')
  })

  it('handles BLOCK with no colon', () => {
    expect(parseGateResponse('BLOCK').allowed).toBe(false)
    expect(parseGateResponse('BLOCK').reason).toBe('no reason given')
  })

  it('trims the reason portion', () => {
    expect(parseGateResponse('ALLOW:   contact confirmed   ').reason).toBe('contact confirmed')
  })
})
