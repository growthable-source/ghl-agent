import { describe, it, expect } from 'vitest'
import { normalizeHost, normalizeCustomDomain } from './portal-branding'

describe('normalizeHost', () => {
  it('lowercases and strips the port', () => {
    expect(normalizeHost('Support.Acme.com:3000')).toBe('support.acme.com')
  })
  it('returns null for empty/missing host', () => {
    expect(normalizeHost(null)).toBeNull()
    expect(normalizeHost('')).toBeNull()
  })
})

describe('normalizeCustomDomain', () => {
  it('strips protocol, path, port, and lowercases', () => {
    expect(normalizeCustomDomain('https://Support.Acme.com/login')).toBe('support.acme.com')
    expect(normalizeCustomDomain('support.acme.com:443')).toBe('support.acme.com')
  })
  it('returns null for blank input (clears the domain)', () => {
    expect(normalizeCustomDomain('')).toBeNull()
    expect(normalizeCustomDomain('   ')).toBeNull()
  })
  it('returns null for an invalid hostname', () => {
    expect(normalizeCustomDomain('not a domain')).toBeNull()
    expect(normalizeCustomDomain('localhost')).toBeNull()
    expect(normalizeCustomDomain('acme')).toBeNull()
  })
  it('accepts a normal subdomain', () => {
    expect(normalizeCustomDomain('support.acme.co.uk')).toBe('support.acme.co.uk')
  })
})
