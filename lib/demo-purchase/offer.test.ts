import { describe, it, expect } from 'vitest'
import {
  offerDeadline,
  offerStatus,
  totalDueToday,
  setupPriceToday,
  countdownParts,
  OFFER_WINDOW_MS,
  SETUP_PRICE,
  INTRO_SETUP_PRICE,
  INTRO_DISCOUNT_PCT,
  MONTHLY_PRICE,
  ANNUAL_PRICE,
} from './offer'

const NOW = new Date('2026-07-21T12:00:00.000Z')

describe('offerDeadline', () => {
  it('anchors to clickedAt, not to now', () => {
    const clicked = new Date('2026-07-21T06:00:00.000Z')
    expect(offerDeadline(clicked, NOW).toISOString()).toBe('2026-07-22T06:00:00.000Z')
  })

  it('falls back to now when clickedAt has not been stamped yet', () => {
    // The first-render window before the status route stamps clickedAt —
    // they are seeing the page right now, so they get the full window.
    expect(offerDeadline(null, NOW).getTime()).toBe(NOW.getTime() + OFFER_WINDOW_MS)
  })

  it('is stable across repeated calls — a refresh must not extend the clock', () => {
    const clicked = new Date('2026-07-21T06:00:00.000Z')
    const first = offerDeadline(clicked, NOW)
    const later = offerDeadline(clicked, new Date(NOW.getTime() + 60 * 60 * 1000))
    expect(later.getTime()).toBe(first.getTime())
  })
})

describe('offerStatus', () => {
  it('is active inside the window and reports the remaining time', () => {
    const clicked = new Date(NOW.getTime() - 60 * 60 * 1000) // clicked 1h ago
    const status = offerStatus(clicked, NOW)
    expect(status.active).toBe(true)
    expect(status.msRemaining).toBe(OFFER_WINDOW_MS - 60 * 60 * 1000)
  })

  it('is inactive once the window has passed', () => {
    const clicked = new Date(NOW.getTime() - OFFER_WINDOW_MS - 1000)
    const status = offerStatus(clicked, NOW)
    expect(status.active).toBe(false)
    expect(status.msRemaining).toBe(0)
  })

  it('treats the exact deadline as expired', () => {
    const clicked = new Date(NOW.getTime() - OFFER_WINDOW_MS)
    expect(offerStatus(clicked, NOW).active).toBe(false)
  })

  it('never reports negative remaining time', () => {
    const clicked = new Date(NOW.getTime() - 10 * OFFER_WINDOW_MS)
    expect(offerStatus(clicked, NOW).msRemaining).toBe(0)
  })
})

describe('pricing', () => {
  it('advertises a discount that never overstates the real saving', () => {
    const realPct = (1 - INTRO_SETUP_PRICE / SETUP_PRICE) * 100
    expect(INTRO_DISCOUNT_PCT).toBeLessThanOrEqual(Math.ceil(realPct))
    expect(realPct).toBeGreaterThanOrEqual(INTRO_DISCOUNT_PCT)
  })

  it('discounts setup on monthly while the offer is live', () => {
    expect(setupPriceToday('monthly', true)).toBe(INTRO_SETUP_PRICE)
    expect(totalDueToday('monthly', true)).toBe(MONTHLY_PRICE + INTRO_SETUP_PRICE)
  })

  it('charges full setup on monthly once the offer expires', () => {
    expect(setupPriceToday('monthly', false)).toBe(SETUP_PRICE)
    expect(totalDueToday('monthly', false)).toBe(MONTHLY_PRICE + SETUP_PRICE)
  })

  it('leaves annual untouched — setup is already waived either way', () => {
    expect(setupPriceToday('annual', true)).toBe(0)
    expect(setupPriceToday('annual', false)).toBe(0)
    expect(totalDueToday('annual', true)).toBe(ANNUAL_PRICE)
    expect(totalDueToday('annual', false)).toBe(ANNUAL_PRICE)
  })
})

describe('countdownParts', () => {
  it('formats a full window as zero-padded clock parts', () => {
    expect(countdownParts(OFFER_WINDOW_MS - 1000)).toEqual({ hours: '23', minutes: '59', seconds: '59' })
  })

  it('zero-pads single digits', () => {
    expect(countdownParts((5 * 60 + 7) * 1000)).toEqual({ hours: '00', minutes: '05', seconds: '07' })
  })

  it('clamps negatives to zero rather than rendering "-01"', () => {
    expect(countdownParts(-5000)).toEqual({ hours: '00', minutes: '00', seconds: '00' })
  })
})
