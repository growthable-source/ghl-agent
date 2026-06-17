import { describe, it, expect } from 'vitest'
import { verifySlackSignature } from './signature'
import { createHmac } from 'node:crypto'

function sign(secret: string, ts: string, body: string) {
  return 'v0=' + createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')
}

describe('verifySlackSignature', () => {
  const secret = 'shhh'
  const body = '{"type":"event_callback"}'
  const now = 1_000_000

  it('accepts a valid signature', () => {
    const ts = String(now)
    const sig = sign(secret, ts, body)
    expect(verifySlackSignature({ secret, signature: sig, timestamp: ts, body, nowSeconds: now })).toBe(true)
  })

  it('rejects a tampered body', () => {
    const ts = String(now)
    const sig = sign(secret, ts, body)
    expect(verifySlackSignature({ secret, signature: sig, timestamp: ts, body: body + 'x', nowSeconds: now })).toBe(false)
  })

  it('rejects a stale timestamp (>5 min)', () => {
    const ts = String(now - 6 * 60)
    const sig = sign(secret, ts, body)
    expect(verifySlackSignature({ secret, signature: sig, timestamp: ts, body, nowSeconds: now })).toBe(false)
  })

  it('rejects a missing/garbage signature', () => {
    expect(verifySlackSignature({ secret, signature: '', timestamp: String(now), body, nowSeconds: now })).toBe(false)
  })

  it('rejects a signature signed with a different secret', () => {
    const ts = String(now)
    const sig = sign('wrong-secret', ts, body)
    expect(verifySlackSignature({ secret, signature: sig, timestamp: ts, body, nowSeconds: now })).toBe(false)
  })
})
