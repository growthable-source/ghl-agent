import { describe, it, expect } from 'vitest'
import { mintPreviewToken, previewModeAllowed, verifyPreviewToken, PREVIEW_TOKEN_DAYS } from './preview-token'

describe('preview token', () => {
  const now = Date.UTC(2026, 9, 27)
  const token = mintPreviewToken('ws_abc123', 'secret', now)

  it('round-trips to the workspace id', () => {
    expect(verifyPreviewToken(token, 'secret', now)).toBe('ws_abc123')
  })

  it('rejects a wrong secret, a tampered workspace or a tampered expiry', () => {
    expect(verifyPreviewToken(token, 'other', now)).toBeNull()
    const [, exp, sig] = token.split('.')
    expect(verifyPreviewToken(`ws_other.${exp}.${sig}`, 'secret', now)).toBeNull()
    expect(verifyPreviewToken(`ws_abc123.${Number(exp) + 1}.${sig}`, 'secret', now)).toBeNull()
  })

  it('expires', () => {
    const later = now + (PREVIEW_TOKEN_DAYS + 1) * 86_400_000
    expect(verifyPreviewToken(token, 'secret', later)).toBeNull()
  })

  it('rejects junk', () => {
    for (const t of ['', 'a.b', 'a.b.c', 'ws.123.zz', null, undefined]) {
      expect(verifyPreviewToken(t, 'secret', now)).toBeNull()
    }
    expect(verifyPreviewToken(token, undefined, now)).toBeNull()
  })
})

describe('previewModeAllowed', () => {
  it('is off in production only', () => {
    expect(previewModeAllowed({ VERCEL_ENV: 'production', NODE_ENV: 'production' })).toBe(false)
    expect(previewModeAllowed({ VERCEL_ENV: 'preview', NODE_ENV: 'production' })).toBe(true)
    expect(previewModeAllowed({ NODE_ENV: 'development' })).toBe(true)
    expect(previewModeAllowed({ NODE_ENV: 'production' })).toBe(false)
  })
})
