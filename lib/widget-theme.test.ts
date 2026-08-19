import { describe, expect, it } from 'vitest'
import { buildWidgetTheme, autoTextColor, luminance } from './widget-theme'

describe('buildWidgetTheme — defaults preserve the historical dark look', () => {
  it('unset background reproduces the near-black default with near-white text', () => {
    const t = buildWidgetTheme({})
    expect(t.bg.toLowerCase()).toBe('#09090b')
    // Auto text on the dark default is near-white (readable).
    expect(luminance(hex(t.fg))).toBeGreaterThan(0.8)
  })
})

describe('buildWidgetTheme — auto text contrast', () => {
  it('a black background gets near-white text', () => {
    const t = buildWidgetTheme({ backgroundColor: '#000000' })
    expect(t.fg).toBe('#f4f4f5')
  })

  it('a white background gets near-black text', () => {
    const t = buildWidgetTheme({ backgroundColor: '#ffffff' })
    expect(t.fg).toBe('#0a0a0a')
  })

  it('the surface stays readable against the text on both extremes', () => {
    for (const bg of ['#000000', '#ffffff', '#fa4d2e']) {
      const t = buildWidgetTheme({ backgroundColor: bg })
      // A meaningful lightness gap between text and its surface.
      const gap = Math.abs(luminance(hex(t.fg)) - luminance(hex(t.surface)))
      expect(gap).toBeGreaterThan(0.2)
    }
  })
})

describe('buildWidgetTheme — explicit text override wins', () => {
  it('respects a set text colour even if it is unusual', () => {
    const t = buildWidgetTheme({ backgroundColor: '#ffffff', textColor: '#1a73e8' })
    expect(t.fg).toBe('#1a73e8')
  })

  it('ignores an empty/invalid override and falls back to auto', () => {
    expect(buildWidgetTheme({ backgroundColor: '#ffffff', textColor: '   ' }).fg).toBe('#0a0a0a')
    expect(buildWidgetTheme({ backgroundColor: '#000000', textColor: 'not-a-color' }).fg).toBe('#f4f4f5')
  })

  it('accepts 3-digit hex and a missing leading #', () => {
    expect(buildWidgetTheme({ backgroundColor: 'fff' }).fg).toBe('#0a0a0a')
    expect(buildWidgetTheme({ backgroundColor: '000' }).fg).toBe('#f4f4f5')
  })
})

describe('autoTextColor', () => {
  it('is dark on light, light on dark', () => {
    expect(autoTextColor({ r: 255, g: 255, b: 255 })).toBe('#0a0a0a')
    expect(autoTextColor({ r: 0, g: 0, b: 0 })).toBe('#f4f4f5')
  })
})

function hex(h: string): { r: number; g: number; b: number } {
  const s = h.replace('#', '')
  return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) }
}
