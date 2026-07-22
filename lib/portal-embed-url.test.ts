import { describe, expect, it } from 'vitest'
import { normalizePortalEmbedUrl } from './portal-embed-url'

describe('normalizePortalEmbedUrl', () => {
  it('accepts a plain https URL', () => {
    expect(normalizePortalEmbedUrl('https://portal.example.com/portal/login?p=acme'))
      .toEqual({ ok: true, url: 'https://portal.example.com/portal/login?p=acme' })
  })

  it('prepends https:// when the scheme is missing', () => {
    expect(normalizePortalEmbedUrl('portal.example.com/portal'))
      .toEqual({ ok: true, url: 'https://portal.example.com/portal' })
  })

  it('trims surrounding whitespace', () => {
    expect(normalizePortalEmbedUrl('  https://portal.example.com  '))
      .toEqual({ ok: true, url: 'https://portal.example.com/' })
  })

  it('rejects http', () => {
    expect(normalizePortalEmbedUrl('http://portal.example.com'))
      .toEqual({ ok: false, reason: 'Portal URL must use https://' })
  })

  it('rejects non-web schemes', () => {
    expect(normalizePortalEmbedUrl('javascript:alert(1)'))
      .toEqual({ ok: false, reason: 'Portal URL must use https://' })
  })

  it('rejects empty input', () => {
    expect(normalizePortalEmbedUrl('   '))
      .toEqual({ ok: false, reason: 'Enter a portal URL' })
  })

  it('rejects garbage that does not parse', () => {
    expect(normalizePortalEmbedUrl('https://'))
      .toEqual({ ok: false, reason: 'That does not look like a valid URL' })
  })

  it('rejects userinfo smuggling', () => {
    expect(normalizePortalEmbedUrl('https://user:pass@evil.com'))
      .toEqual({ ok: false, reason: 'That does not look like a valid URL' })
  })
})
