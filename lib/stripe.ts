/**
 * Stripe client singleton for server-side usage.
 * Lazily initialised so the app can build/run without STRIPE_SECRET_KEY
 * (billing routes will return 503 until the key is configured).
 */
import Stripe from 'stripe'

let _stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY is not configured')
  }
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      typescript: true,
    })
  }
  return _stripe
}

/**
 * Convenience getter — same as getStripe() but usable as a direct import.
 * Throws at call time if the key is missing.
 */
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return (getStripe() as any)[prop]
  },
})
