import { describe, it, expect } from 'vitest'
import { validatePublicUrl, InvalidUrlError } from './validate-url'

describe('validatePublicUrl', () => {
  it('accepts a bare domain and defaults to https', () => {
    const result = validatePublicUrl('acmeplumbing.com')
    expect(result.normalizedUrl).toBe('https://acmeplumbing.com/')
    expect(result.domain).toBe('acmeplumbing.com')
  })

  it('accepts an explicit http(s) URL with path/query', () => {
    const result = validatePublicUrl('http://www.AcmePlumbing.com/about?x=1')
    expect(result.domain).toBe('acmeplumbing.com')
  })

  it('rejects empty input', () => {
    expect(() => validatePublicUrl('')).toThrow(InvalidUrlError)
    expect(() => validatePublicUrl('   ')).toThrow(InvalidUrlError)
  })

  it('rejects garbage input', () => {
    expect(() => validatePublicUrl('not a url !!')).toThrow(InvalidUrlError)
  })

  it('rejects non-http(s) protocols', () => {
    expect(() => validatePublicUrl('ftp://example.com')).toThrow(InvalidUrlError)
    expect(() => validatePublicUrl('file:///etc/passwd')).toThrow(InvalidUrlError)
  })

  it('rejects IPv4 literal hosts', () => {
    expect(() => validatePublicUrl('http://127.0.0.1')).toThrow(InvalidUrlError)
    expect(() => validatePublicUrl('http://10.0.0.5/admin')).toThrow(InvalidUrlError)
    expect(() => validatePublicUrl('169.254.169.254')).toThrow(InvalidUrlError)
  })

  it('rejects IPv6 literal hosts', () => {
    expect(() => validatePublicUrl('http://[::1]')).toThrow(InvalidUrlError)
    expect(() => validatePublicUrl('http://[fe80::1]')).toThrow(InvalidUrlError)
  })

  it('rejects localhost', () => {
    expect(() => validatePublicUrl('http://localhost:3000')).toThrow(InvalidUrlError)
    expect(() => validatePublicUrl('localhost')).toThrow(InvalidUrlError)
  })

  it('rejects hosts with no dot', () => {
    expect(() => validatePublicUrl('http://intranet')).toThrow(InvalidUrlError)
  })

  it('rejects internal-looking TLDs', () => {
    expect(() => validatePublicUrl('http://printer.local')).toThrow(InvalidUrlError)
    expect(() => validatePublicUrl('http://server.internal')).toThrow(InvalidUrlError)
    expect(() => validatePublicUrl('http://box.lan')).toThrow(InvalidUrlError)
    expect(() => validatePublicUrl('http://router.home')).toThrow(InvalidUrlError)
    expect(() => validatePublicUrl('http://1.2.3.4.in-addr.arpa')).toThrow(InvalidUrlError)
  })
})
