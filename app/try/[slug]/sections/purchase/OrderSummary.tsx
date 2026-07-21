import Image from 'next/image'
import { Check } from 'lucide-react'
import type { PurchasePeriod } from '@/lib/demo-purchase/state'
import {
  MONTHLY_PRICE,
  ANNUAL_PRICE,
  SETUP_PRICE,
  INTRO_SETUP_PRICE,
  INTRO_DISCOUNT_PCT,
  totalDueToday,
} from '@/lib/demo-purchase/offer'
import { TESTIMONIALS } from '../Testimonials'
import OfferCountdown from './OfferCountdown'

/**
 * Offer-stack order summary shown alongside Embedded Checkout in
 * StepPayment. Pricing shown here is display copy only — the actual
 * amount charged always comes from the server-side Stripe price
 * allowlist (lib/plans.ts STRIPE_PRICES.demoBundle). The numbers now come
 * from lib/demo-purchase/offer.ts, which the checkout route imports too,
 * so what's rendered here and what's charged can't drift apart.
 *
 * `introDeadline` is null when the intro window has already closed (or
 * was never configured) — in that case this renders exactly as it did
 * before the offer existed: full setup price, no countdown.
 */
const OFFER_NAME = 'AI Voice Receptionist + CRM Bundle'
const ITEMS = ['AI receptionist, answering calls 24/7', 'CRM bundle — leads, contacts & follow-up included', 'Setup & onboarding']

export default function OrderSummary({
  period,
  onPeriodChange,
  disabled,
  introDeadline,
  onIntroExpire,
}: {
  period: PurchasePeriod
  onPeriodChange: (period: PurchasePeriod) => void
  disabled?: boolean
  introDeadline: string | null
  onIntroExpire?: () => void
}) {
  const introActive = Boolean(introDeadline)
  const totalToday = totalDueToday(period, introActive)
  const testimonial = TESTIMONIALS[0]

  return (
    <div className="vox-card p-6 flex flex-col gap-5">
      {/* Countdown sits above the plan toggle — it's the reason to decide
          now, so it should be read before the price, not after it. Only
          shown on monthly: annual already waives setup outright, so a
          "% off setup" clock there would be counting down to nothing. */}
      {introDeadline && period === 'monthly' && (
        <OfferCountdown deadline={introDeadline} onExpire={onIntroExpire} />
      )}

      <div>
        <p className="text-sm font-bold mb-3" style={{ color: 'var(--text-primary)' }}>{OFFER_NAME}</p>
        <p className="section-label mb-3">Your plan</p>
        <div
          className="inline-flex items-center rounded-full border p-1 gap-1 w-full sm:w-auto"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)' }}
        >
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPeriodChange('monthly')}
            className="flex-1 sm:flex-none text-sm font-semibold rounded-full px-4 py-2 transition-colors disabled:opacity-60"
            style={
              period === 'monthly'
                ? { background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }
                : { color: 'var(--text-secondary)' }
            }
          >
            Monthly
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onPeriodChange('annual')}
            className="flex-1 sm:flex-none text-sm font-semibold rounded-full px-4 py-2 transition-colors disabled:opacity-60"
            style={
              period === 'annual'
                ? { background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }
                : { color: 'var(--text-secondary)' }
            }
          >
            Annual
          </button>
        </div>
        {period === 'annual' && (
          <p className="mt-2 text-xs font-semibold" style={{ color: 'var(--accent-emerald)' }}>
            Save $497 setup + 2 months
          </p>
        )}
      </div>

      <ul className="flex flex-col gap-2.5">
        {ITEMS.map((label, i) => (
          <li key={label} className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <Check className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--accent-emerald)' }} />
            <span>
              {label}
              {i === 2 && (
                <span className="ml-1.5">
                  {period === 'annual' ? (
                    <>
                      <span className="line-through" style={{ color: 'var(--text-tertiary)' }}>
                        ${SETUP_PRICE}
                      </span>{' '}
                      <span className="font-semibold" style={{ color: 'var(--accent-emerald)' }}>
                        FREE
                      </span>
                    </>
                  ) : introActive ? (
                    <>
                      <span className="line-through" style={{ color: 'var(--text-tertiary)' }}>
                        ${SETUP_PRICE}
                      </span>{' '}
                      <span className="font-semibold" style={{ color: 'var(--accent-emerald)' }}>
                        ${INTRO_SETUP_PRICE}
                      </span>{' '}
                      <span style={{ color: 'var(--text-tertiary)' }}>one-time</span>
                    </>
                  ) : (
                    <span style={{ color: 'var(--text-tertiary)' }}>(${SETUP_PRICE}, one-time)</span>
                  )}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Total due today
          </span>
          <span className="flex items-baseline gap-2">
            {introActive && period === 'monthly' && (
              <span className="text-base line-through" style={{ color: 'var(--text-tertiary)' }}>
                ${(MONTHLY_PRICE + SETUP_PRICE).toLocaleString()}
              </span>
            )}
            <span className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>
              ${totalToday.toLocaleString()}
            </span>
          </span>
        </div>
        {introActive && period === 'monthly' && (
          <p className="mt-1 text-xs font-semibold" style={{ color: 'var(--accent-emerald)' }}>
            You save ${(SETUP_PRICE - INTRO_SETUP_PRICE).toLocaleString()} — {INTRO_DISCOUNT_PCT}% off setup, today only
          </p>
        )}
        <p className="mt-1 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {period === 'monthly' ? `Then $${MONTHLY_PRICE}/mo` : `Then $${ANNUAL_PRICE.toLocaleString()}/yr`} — 14-day money-back guarantee · Cancel anytime
        </p>
      </div>

      <div className="rounded-2xl p-4 border" style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)' }}>
        <p className="mb-2.5 text-xs" style={{ color: 'var(--accent-amber)' }}>★★★★★</p>
        <p className="italic text-[13px] leading-[1.6] mb-3" style={{ color: 'var(--text-secondary)' }}>
          &ldquo;{testimonial.quote}&rdquo;
        </p>
        <div className="flex items-center gap-2.5">
          <div className="relative w-7 h-7 rounded-full overflow-hidden shrink-0">
            <Image src={testimonial.avatar} alt="" width={28} height={28} className="object-cover w-full h-full" />
          </div>
          <div>
            <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{testimonial.name}</p>
            <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{testimonial.role}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
