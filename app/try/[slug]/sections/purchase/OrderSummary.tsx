import Image from 'next/image'
import { Check } from 'lucide-react'
import type { PurchasePeriod } from '@/lib/demo-purchase/state'
import { TESTIMONIALS } from '../Testimonials'

/**
 * Offer-stack order summary shown alongside Embedded Checkout in
 * StepPayment. Pricing shown here is display copy only — the actual
 * amount charged always comes from the server-side Stripe price
 * allowlist (lib/plans.ts STRIPE_PRICES.demoBundle), never from these
 * hardcoded numbers. Keep them in sync with whatever prices Ryan creates
 * in the Stripe dashboard (see the plan's "Ryan must do" list: $297/mo,
 * $2,970/yr, $497 one-time setup).
 */
const MONTHLY_PRICE = 297
const ANNUAL_PRICE = 2970
const SETUP_PRICE = 497

const ITEMS = ['AI receptionist, answering calls 24/7', 'CRM bundle — leads, contacts & follow-up included', 'Setup & onboarding']

export default function OrderSummary({
  period,
  onPeriodChange,
  disabled,
}: {
  period: PurchasePeriod
  onPeriodChange: (period: PurchasePeriod) => void
  disabled?: boolean
}) {
  const totalToday = period === 'monthly' ? MONTHLY_PRICE + SETUP_PRICE : ANNUAL_PRICE
  const testimonial = TESTIMONIALS[0]

  return (
    <div className="vox-card p-6 flex flex-col gap-5">
      <div>
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
          <span className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>
            ${totalToday.toLocaleString()}
          </span>
        </div>
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
