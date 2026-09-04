import { describe, it, expect } from 'vitest'
import { sanitizeEmailSubject } from './email-subject'

describe('sanitizeEmailSubject', () => {
  it('flattens the newlines that made Resend reject a ticket reply', () => {
    const pasted = 'Failed at: create ad set\nAdvertiser is missing\nProvide a verified advertiser'
    expect(sanitizeEmailSubject(pasted))
      .toBe('Failed at: create ad set Advertiser is missing Provide a verified advertiser')
  })

  it('strips CRLF, tabs and other control characters', () => {
    expect(sanitizeEmailSubject('a\r\nb\tc\x00d')).toBe('a b c d')
  })

  it('strips the Unicode line/paragraph separators too', () => {
    expect(sanitizeEmailSubject('a\u2028b\u2029c')).toBe('a b c')
  })

  it('leaves a well-formed subject untouched', () => {
    expect(sanitizeEmailSubject('Billing question')).toBe('Billing question')
  })

  it('collapses runs of whitespace and trims the edges', () => {
    expect(sanitizeEmailSubject('  too   much   room  ')).toBe('too much room')
  })

  it('falls back when the subject is empty or only control characters', () => {
    expect(sanitizeEmailSubject('')).toBe('(no subject)')
    expect(sanitizeEmailSubject('\n\t ')).toBe('(no subject)')
    expect(sanitizeEmailSubject(null)).toBe('(no subject)')
    expect(sanitizeEmailSubject(undefined, { fallback: 'Ticket update' })).toBe('Ticket update')
  })

  it('truncates past the cap with an ellipsis', () => {
    const out = sanitizeEmailSubject('x'.repeat(500))
    expect(out).toHaveLength(200)
    expect(out.endsWith('…')).toBe(true)
  })

  it('honours a caller-supplied cap', () => {
    expect(sanitizeEmailSubject('abcdefghij', { maxLength: 5 })).toBe('abcd…')
  })
})
