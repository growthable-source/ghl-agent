import { describe, it, expect } from 'vitest'
import { parseGateResponse, parseBatchGateResponse } from './tool-gate'

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

describe('parseBatchGateResponse', () => {
  it('parses one verdict line per item, in order', () => {
    const text = `[1] ALLOW: contact picked 3pm
[2] BLOCK: no email yet`
    expect(parseBatchGateResponse(text, 2)).toEqual([
      { allowed: true, reason: 'contact picked 3pm' },
      { allowed: false, reason: 'no email yet' },
    ])
  })

  it('maps by item number even when lines are out of order', () => {
    const text = `[2] BLOCK: missing budget
[1] ALLOW: qualified`
    const out = parseBatchGateResponse(text, 2)
    expect(out[0]).toEqual({ allowed: true, reason: 'qualified' })
    expect(out[1]).toEqual({ allowed: false, reason: 'missing budget' })
  })

  it('fails open for an item with no decision line', () => {
    const text = `[1] BLOCK: not ready`
    const out = parseBatchGateResponse(text, 2)
    expect(out[0]).toEqual({ allowed: false, reason: 'not ready' })
    expect(out[1].allowed).toBe(true)
    expect(out[1].reason).toMatch(/parse_failure/)
  })

  it('ignores surrounding noise and prose', () => {
    const text = `Here are my decisions:
[1] ALLOW: looks good
Thanks!`
    expect(parseBatchGateResponse(text, 1)).toEqual([{ allowed: true, reason: 'looks good' }])
  })

  it('fails open for every item when the response is empty', () => {
    const out = parseBatchGateResponse('', 3)
    expect(out).toHaveLength(3)
    expect(out.every(d => d.allowed)).toBe(true)
  })

  it('reuses single-line parsing semantics (no colon)', () => {
    const out = parseBatchGateResponse('[1] BLOCK\n[2] ALLOW', 2)
    expect(out[0]).toEqual({ allowed: false, reason: 'no reason given' })
    expect(out[1]).toEqual({ allowed: true, reason: 'allowed' })
  })
})
