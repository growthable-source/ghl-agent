import { describe, it, expect } from 'vitest'
import { parseWindow } from './api-scope'

describe('parseWindow', () => {
  it('defaults to trailing 30 days', () => {
    const w = parseWindow(new URL('https://x/api/v1/tickets/metrics'))
    const ms = w.to.getTime() - w.from.getTime()
    expect(Math.round(ms / 86400000)).toBe(30)
  })
  it('honours days', () => {
    const w = parseWindow(new URL('https://x/y?days=7'))
    expect(Math.round((w.to.getTime() - w.from.getTime()) / 86400000)).toBe(7)
  })
  it('rejects days out of range', () => {
    expect(() => parseWindow(new URL('https://x/y?days=999'))).toThrow()
  })
  it('explicit from/to overrides days', () => {
    const w = parseWindow(new URL('https://x/y?from=2026-01-01&to=2026-01-08'))
    expect(w.from.toISOString().slice(0, 10)).toBe('2026-01-01')
    expect(w.to.toISOString().slice(0, 10)).toBe('2026-01-08')
  })
  it('reads brandId and no_brand', () => {
    expect(parseWindow(new URL('https://x/y?brandId=b1')).brandId).toBe('b1')
    expect(parseWindow(new URL('https://x/y?brandId=no_brand')).brandId).toBe('no_brand')
  })
})
