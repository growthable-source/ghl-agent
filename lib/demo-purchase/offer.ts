/**
 * Single source of truth for the /try/[slug] bundle's pricing and the
 * limited-time intro offer (80% off the one-time setup fee).
 *
 * WHY THIS MODULE EXISTS: the display prices used to be hardcoded
 * constants in OrderSummary.tsx with a "keep them in sync with Stripe"
 * comment. Adding a time-boxed discount doubles the number of things that
 * can silently drift apart (shown price vs charged price vs advertised
 * percentage), so every number now lives here and is imported by BOTH the
 * server route that picks the Stripe price id and the client components
 * that render the offer.
 *
 * The amounts below are still display copy — the actual charge always
 * comes from the server-side Stripe price allowlist (lib/plans.ts
 * STRIPE_PRICES.demoBundle). These must match the prices Ryan creates in
 * the Stripe dashboard:
 *   setup       → $497 one-time   (STRIPE_PRICE_DEMO_BUNDLE_SETUP)
 *   setupIntro  → $97 one-time    (STRIPE_PRICE_DEMO_BUNDLE_SETUP_INTRO)
 *   monthly     → $297/mo         (STRIPE_PRICE_DEMO_BUNDLE_MONTHLY)
 *   annual      → $2,970/yr       (STRIPE_PRICE_DEMO_BUNDLE_ANNUAL)
 *
 * THE URGENCY IS REAL, NOT THEATRE. The countdown is anchored to the
 * prospect's persisted `clickedAt` (stamped once, on their first view of
 * the lander — see app/api/public/try/[slug]/status/route.ts), NOT to a
 * client-side `Date.now() + 24h`. That matters for two reasons:
 *   1. Honesty/trust — a refresh doesn't reset the clock. A visitor who
 *      reloads and sees the timer jump back to 24:00:00 knows instantly
 *      the whole page is lying to them, and that costs more than the
 *      discount ever earns.
 *   2. Correctness — the same deadline drives what we DISPLAY and what we
 *      CHARGE. The server re-derives it from the DB row at checkout-mint
 *      time, so a visitor can't hand us an "offer still active" flag.
 */

/** Display prices, in whole dollars. See the doc comment above. */
export const MONTHLY_PRICE = 297
export const ANNUAL_PRICE = 2970
export const SETUP_PRICE = 497
export const INTRO_SETUP_PRICE = 97

/**
 * Advertised discount, DERIVED from the two setup prices rather than
 * asserted as its own constant — so changing INTRO_SETUP_PRICE can never
 * leave a stale "80% off" badge overstating the deal. At $497 → $97 this
 * rounds to 80 (the real saving is 80.5%, i.e. marginally better than
 * advertised, which is the safe direction to round).
 */
export const INTRO_DISCOUNT_PCT = Math.round((1 - INTRO_SETUP_PRICE / SETUP_PRICE) * 100)

/** How long after their first view the intro price stays available. */
export const OFFER_WINDOW_MS = 24 * 60 * 60 * 1000

export interface OfferStatus {
  /** Whether the intro setup price applies right now. */
  active: boolean
  /** ISO deadline — safe to send to the client and render a countdown from. */
  deadline: string
  /** Milliseconds left; 0 once expired. */
  msRemaining: number
}

/**
 * Derive the offer deadline for a prospect.
 *
 * `clickedAt` is null only in the narrow window between a visitor's first
 * page render and the status-route poll that stamps it — i.e. they are
 * looking at the page for the very first time right now, so `now` is the
 * correct anchor. Both the SSR render and the checkout route fall back
 * identically, so display and enforcement agree.
 */
export function offerDeadline(clickedAt: Date | null | undefined, now: Date = new Date()): Date {
  const anchor = clickedAt ?? now
  return new Date(anchor.getTime() + OFFER_WINDOW_MS)
}

export function offerStatus(clickedAt: Date | null | undefined, now: Date = new Date()): OfferStatus {
  const deadline = offerDeadline(clickedAt, now)
  const msRemaining = Math.max(0, deadline.getTime() - now.getTime())
  return { active: msRemaining > 0, deadline: deadline.toISOString(), msRemaining }
}

/** What the buyer pays today, given period + whether the intro offer holds. */
export function totalDueToday(period: 'monthly' | 'annual', introActive: boolean): number {
  // Annual already waives setup entirely, so the intro discount is a
  // monthly-only lever — it makes monthly easier to say yes to without
  // cannibalizing the (better) annual offer.
  if (period === 'annual') return ANNUAL_PRICE
  return MONTHLY_PRICE + (introActive ? INTRO_SETUP_PRICE : SETUP_PRICE)
}

/** Setup-line amount for display, given period + offer state. */
export function setupPriceToday(period: 'monthly' | 'annual', introActive: boolean): number {
  if (period === 'annual') return 0
  return introActive ? INTRO_SETUP_PRICE : SETUP_PRICE
}

/**
 * Split milliseconds into clock parts for the countdown UI. Caps the hour
 * field rather than rolling into days — the window is 24h, so a visitor
 * never sees a day counter, and "23:59:12" reads more urgently than
 * "0d 23h".
 */
export function countdownParts(ms: number): { hours: string; minutes: string; seconds: string } {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return { hours: pad(hours), minutes: pad(minutes), seconds: pad(seconds) }
}
