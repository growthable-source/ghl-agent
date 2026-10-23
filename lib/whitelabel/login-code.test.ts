import { describe, it, expect } from 'vitest'
import {
  brandedFromAddress, codeMatches, codeState, generateLoginCode, hashLoginCode,
  MAX_CODE_ATTEMPTS, normalizeCode, normalizeEmail, safeCallbackPath,
} from './login-code'

describe('generateLoginCode', () => {
  it('is always six digits', () => {
    for (let i = 0; i < 200; i++) expect(generateLoginCode()).toMatch(/^\d{6}$/)
  })
})

describe('normalizeEmail / normalizeCode', () => {
  it('normalizes and rejects junk', () => {
    expect(normalizeEmail('  Jo@Acme.COM ')).toBe('jo@acme.com')
    expect(normalizeEmail('nope')).toBeNull()
    expect(normalizeEmail(42)).toBeNull()
    expect(normalizeCode('123 456')).toBe('123456')
    expect(normalizeCode('12345')).toBeNull()
    expect(normalizeCode(undefined)).toBeNull()
  })
})

describe('code hashing', () => {
  const h = hashLoginCode('123456', 'ws1', 'jo@acme.com', 's')
  it('matches only the same code, workspace, email and secret', () => {
    expect(codeMatches('123456', 'ws1', 'jo@acme.com', 's', h)).toBe(true)
    expect(codeMatches('123457', 'ws1', 'jo@acme.com', 's', h)).toBe(false)
    expect(codeMatches('123456', 'ws2', 'jo@acme.com', 's', h)).toBe(false)
    expect(codeMatches('123456', 'ws1', 'al@acme.com', 's', h)).toBe(false)
    expect(codeMatches('123456', 'ws1', 'jo@acme.com', 't', h)).toBe(false)
    expect(codeMatches('123456', 'ws1', 'jo@acme.com', 's', 'abcd')).toBe(false)
  })
})

describe('codeState', () => {
  const now = new Date('2026-10-23T00:00:00Z')
  const later = new Date(now.getTime() + 60_000)
  it('reports why a code is unusable', () => {
    expect(codeState({ expiresAt: later, consumedAt: null, attempts: 0 }, now)).toBe('usable')
    expect(codeState({ expiresAt: now, consumedAt: null, attempts: 0 }, now)).toBe('expired')
    expect(codeState({ expiresAt: later, consumedAt: now, attempts: 0 }, now)).toBe('used')
    expect(codeState({ expiresAt: later, consumedAt: null, attempts: MAX_CODE_ATTEMPTS }, now)).toBe('locked')
  })
})

describe('brandedFromAddress', () => {
  it('keeps our mailbox and shows the brand name', () => {
    expect(brandedFromAddress('Acme Support', 'Xovera <notifications@xovera.io>')).toBe('"Acme Support" <notifications@xovera.io>')
    expect(brandedFromAddress('Acme', 'notifications@xovera.io')).toBe('"Acme" <notifications@xovera.io>')
    expect(brandedFromAddress('Ev"il\r\nBcc: x', 'a@b.io')).toBe('"EvilBcc: x" <a@b.io>')
  })
})

describe('safeCallbackPath', () => {
  it('only allows this workspace’s dashboard', () => {
    expect(safeCallbackPath('/dashboard/ws1/inbox?c=1', 'ws1')).toBe('/dashboard/ws1/inbox?c=1')
    expect(safeCallbackPath('/dashboard/ws1', 'ws1')).toBe('/dashboard/ws1')
    expect(safeCallbackPath('/dashboard/ws2/inbox', 'ws1')).toBeNull()
    expect(safeCallbackPath('/dashboard/ws1x/inbox', 'ws1')).toBeNull()
    expect(safeCallbackPath('https://evil.com', 'ws1')).toBeNull()
    expect(safeCallbackPath('//evil.com', 'ws1')).toBeNull()
    expect(safeCallbackPath(null, 'ws1')).toBeNull()
  })
})
