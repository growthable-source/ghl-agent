import { describe, it, expect } from 'vitest'
import { getBrand, brandKeyFromMetadata, brandCssVars, DEFAULT_BRAND_KEY } from './index'

describe('getBrand', () => {
  it('falls back to Xovera for absent/unknown keys', () => {
    expect(getBrand(null).key).toBe(DEFAULT_BRAND_KEY)
    expect(getBrand(undefined).key).toBe(DEFAULT_BRAND_KEY)
    expect(getBrand('').key).toBe(DEFAULT_BRAND_KEY)
    expect(getBrand('not-a-brand').key).toBe(DEFAULT_BRAND_KEY)
  })

  it('resolves ASC Warranty by every spelling the prospecting tool might send', () => {
    for (const key of ['asc', 'ASC', ' asc-warranty ', 'ascwarranty', 'ASC-Warranty']) {
      expect(getBrand(key).name).toBe('ASC Warranty')
    }
  })
})

describe('brandKeyFromMetadata', () => {
  it('reads a string brand', () => {
    expect(brandKeyFromMetadata({ brand: 'asc' })).toBe('asc')
    expect(brandKeyFromMetadata({ brand: '  asc  ' })).toBe('asc')
  })

  it('treats anything non-string (or missing) as unset rather than coercing', () => {
    expect(brandKeyFromMetadata(null)).toBeNull()
    expect(brandKeyFromMetadata(undefined)).toBeNull()
    expect(brandKeyFromMetadata({})).toBeNull()
    expect(brandKeyFromMetadata({ brand: '' })).toBeNull()
    expect(brandKeyFromMetadata({ brand: 42 })).toBeNull()
    expect(brandKeyFromMetadata({ brand: { name: 'asc' } })).toBeNull()
    expect(brandKeyFromMetadata('asc')).toBeNull()
  })

  it('round-trips through getBrand so a malformed value degrades to Xovera', () => {
    expect(getBrand(brandKeyFromMetadata({ brand: 99 })).key).toBe(DEFAULT_BRAND_KEY)
  })
})

describe('brandCssVars', () => {
  it('is empty for Xovera so the stock palette is untouched', () => {
    expect(brandCssVars(getBrand('xovera'))).toEqual({})
  })

  it('overrides --gradient-primary for palette brands (what .btn-primary actually paints)', () => {
    const vars = brandCssVars(getBrand('asc'))
    // Missing this one is the specific bug where every CTA stays orange
    // on an otherwise-rebranded page.
    expect(vars['--gradient-primary']).toContain('#dd2023')
    expect(vars['--accent-primary']).toBe('#dd2023')
    expect(vars['--gradient-text']).toContain('#dd2023')
    expect(vars['--shadow-primary']).toContain('221, 32, 35')
  })
})

describe('brand content', () => {
  const brands = ['xovera', 'asc'].map(getBrand)

  it('every brand ships a full set of sections', () => {
    for (const b of brands) {
      expect(b.features.length, b.key).toBeGreaterThan(0)
      expect(b.stats.length, b.key).toBeGreaterThan(0)
      expect(b.testimonials.length, b.key).toBeGreaterThan(0)
      expect(b.steps.length, b.key).toBeGreaterThan(0)
      // OrderSummary renders testimonials[0] unconditionally.
      expect(b.testimonials[0], b.key).toBeTruthy()
      expect(b.support.contactSentence, b.key).toBeTruthy()
    }
  })

  it('no brand reuses another brand’s testimonials', () => {
    // Guard on the honesty rule: a whitelabel lander must show its OWN
    // customers. Copying Xovera's quotes onto a partner page would be
    // presenting fabricated reviews for a business that never gave them.
    const seen = new Map<string, string>()
    for (const b of brands) {
      for (const t of b.testimonials) {
        const prior = seen.get(t.quote)
        expect(prior, `"${t.quote.slice(0, 40)}…" appears in both ${prior} and ${b.key}`).toBeUndefined()
        seen.set(t.quote, b.key)
      }
    }
  })

  it('never pairs a stock avatar with a real named partner customer', () => {
    // ASC's testimonials are real, published dealer quotes with no
    // portraits — TestimonialAvatar renders initials instead. If someone
    // later drops an avatar path in, it must be a real photo of that
    // person, not one of Xovera's stock files.
    const xoveraAvatars = new Set(getBrand('xovera').testimonials.map(t => t.avatar).filter(Boolean))
    for (const t of getBrand('asc').testimonials) {
      expect(xoveraAvatars.has(t.avatar), t.name).toBe(false)
    }
  })
})
