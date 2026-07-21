import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js'
import type { Stripe } from '@stripe/stripe-js'
import type { PurchasePeriod } from '@/lib/demo-purchase/state'
import OrderSummary from './OrderSummary'

/**
 * PurchaseModal step 2 — Embedded Checkout + the offer-stack order
 * summary, two columns on ≥md. `stripePromise` is a module-level
 * singleton (see PurchaseModal.tsx); `clientSecret` changes on every
 * monthly/annual toggle (a fresh POST to checkout-session/route.ts mints
 * a new one) so the `key` prop on EmbeddedCheckoutProvider below forces a
 * clean remount rather than trying to hot-swap a session mid-flight —
 * `stripe` docs say the clientSecret prop can't change after first mount.
 */
export default function StepPayment({
  stripePromise,
  clientSecret,
  sessionId,
  period,
  onPeriodChange,
  onPeriodChangeError,
  changingPeriod,
  onComplete,
  introDeadline,
  onIntroExpire,
}: {
  stripePromise: Promise<Stripe | null>
  clientSecret: string
  sessionId: string
  period: PurchasePeriod
  onPeriodChange: (period: PurchasePeriod) => void
  onPeriodChangeError: string | null
  changingPeriod: boolean
  onComplete: () => void
  introDeadline: string | null
  onIntroExpire: () => void
}) {
  return (
    <div className="grid md:grid-cols-[1fr_1.1fr] gap-6 items-start">
      <div className="order-2 md:order-1">
        <OrderSummary
          period={period}
          onPeriodChange={onPeriodChange}
          disabled={changingPeriod}
          introDeadline={introDeadline}
          onIntroExpire={onIntroExpire}
        />
        {onPeriodChangeError && <p className="mt-3 text-sm text-accent-red">{onPeriodChangeError}</p>}
      </div>
      <div className="order-1 md:order-2 min-h-[420px]">
        {changingPeriod ? (
          <div className="flex items-center justify-center h-[420px]">
            <div className="h-2 w-2 rounded-full animate-pulse" style={{ background: 'var(--text-muted)' }} />
          </div>
        ) : (
          <EmbeddedCheckoutProvider
            key={sessionId}
            stripe={stripePromise}
            options={{ clientSecret, onComplete }}
          >
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        )}
      </div>
    </div>
  )
}
