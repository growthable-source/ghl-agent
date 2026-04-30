import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifyMetaSignature } from './meta-webhook-verify'

const APP_SECRET = 'test_app_secret_do_not_use_in_prod'

function sign(body: string, secret = APP_SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

describe('verifyMetaSignature', () => {
  it('accepts a correctly signed body', () => {
    const body = JSON.stringify({ object: 'page', entry: [] })
    const sig = sign(body)
    expect(verifyMetaSignature(body, sig, APP_SECRET)).toEqual({ ok: true })
  })

  it('rejects a body that has been tampered with after signing', () => {
    const body = JSON.stringify({ object: 'page', entry: [] })
    const sig = sign(body)
    const tampered = body.replace('page', 'pAge')
    const r = verifyMetaSignature(tampered, sig, APP_SECRET)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('signature mismatch')
  })

  it('rejects when the wrong app secret is used', () => {
    const body = '{"x":1}'
    const sig = sign(body, 'attacker_secret')
    const r = verifyMetaSignature(body, sig, APP_SECRET)
    expect(r.ok).toBe(false)
  })

  it('rejects missing or malformed signature headers', () => {
    expect(verifyMetaSignature('{}', null, APP_SECRET).ok).toBe(false)
    expect(verifyMetaSignature('{}', undefined, APP_SECRET).ok).toBe(false)
    expect(verifyMetaSignature('{}', '', APP_SECRET).ok).toBe(false)
    expect(verifyMetaSignature('{}', 'no-prefix-deadbeef', APP_SECRET).ok).toBe(false)
    expect(verifyMetaSignature('{}', 'sha256=tooShort', APP_SECRET).ok).toBe(false)
    expect(verifyMetaSignature('{}', 'sha256=' + 'g'.repeat(64), APP_SECRET).ok).toBe(false)
  })

  it('rejects when no app secret is configured', () => {
    const body = '{}'
    const sig = sign(body)
    const r = verifyMetaSignature(body, sig, '')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no app secret configured')
  })

  it('treats Buffer and string bodies identically', () => {
    const body = '{"hello":"world"}'
    const sig = sign(body)
    expect(verifyMetaSignature(body, sig, APP_SECRET).ok).toBe(true)
    expect(verifyMetaSignature(Buffer.from(body, 'utf8'), sig, APP_SECRET).ok).toBe(true)
  })

  it('is case-insensitive on the hex but not on prefix', () => {
    const body = '{}'
    const goodHex = createHmac('sha256', APP_SECRET).update(body).digest('hex')
    // Lowercase the prefix only, uppercase the hex — should still verify
    expect(verifyMetaSignature(body, 'sha256=' + goodHex.toUpperCase(), APP_SECRET).ok).toBe(true)
    // Wrong prefix capitalisation must fail (we lower-case the hex but
    // require the literal "sha256=" prefix)
    expect(verifyMetaSignature(body, 'SHA256=' + goodHex, APP_SECRET).ok).toBe(false)
  })

  it('handles empty body deterministically', () => {
    const sig = sign('')
    expect(verifyMetaSignature('', sig, APP_SECRET).ok).toBe(true)
    expect(verifyMetaSignature('', 'sha256=' + '0'.repeat(64), APP_SECRET).ok).toBe(false)
  })
})
