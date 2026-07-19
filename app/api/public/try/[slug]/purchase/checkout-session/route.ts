/**
 * POST /api/public/try/[slug]/purchase/checkout-session
 *
 * Mints (or re-mints, on a monthly/annual toggle) a Stripe embedded
 * Checkout Session for the demo-bundle offer sold off the /try/[slug]
 * lander. Body: `{ name?, email, period }`.
 *
 * Security posture mirrors the other public /try/[slug] routes (see
 * app/api/public/try/[slug]/train/route.ts and .../web-token/route.ts):
 * unauthenticated, slug-as-credential (the slug itself is unguessable —
 * 8 hex chars, lib/demo-prospects/slug.ts), server-side price allowlist
 * only (never trust a client-supplied Stripe price id), and best-effort
 * per-IP + per-slug rate caps so a single visitor can't spin up unbounded
 * Stripe Checkout Sessions.
 *
 * Contact email is persisted immediately (before payment) as the
 * abandoned-checkout remarketing hook — see the `purchase.contactEmail`
 * + `state: 'checkout_started'` projection the prospecting tool reads via
 * GET /api/v1/demo-prospects (Task 5 wires that projection in; this
 * route's job is just to make sure the data lands).
 *
 * The Stripe Checkout Session id is ALSO persisted immediately (as
 * `purchase.stripeSessionId`) rather than waiting for the webhook's
 * `paid` transition to stamp it — Task 3's public status/numbers/number
 * routes gate on "session_id matches stored stripeSessionId" as a
 * possession check (the /try/[slug] link is shareable; the slug alone
 * must not expose whether/what someone purchased), and that check has to
 * work from PurchaseModal's very first poll, immediately after the
 * embedded Checkout completes client-side — which can be seconds before
 * the webhook has actually landed and run fulfillDemoBundle(). Non-CAS,
 * last-write-wins, same posture as startOrUpdateCheckout above: this is
 * pre-payment bookkeeping, not state-machine advancement.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { stripe } from '@/lib/stripe'
import { db } from '@/lib/db'
import { STRIPE_PRICES } from '@/lib/plans'
import { startOrUpdateCheckout, mergePurchaseMetadata, type PurchasePeriod } from '@/lib/demo-purchase/state'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EXPIRES_EXTEND_MS = 14 * 24 * 60 * 60 * 1000 // 14 days — matches the reaper's normal TTL window

// ── Best-effort in-process rate caps ─────────────────────────────────────
// Not distributed (each warm serverless instance has its own Maps) — the
// same tradeoff lib/tag-policy.ts and lib/widget-pubsub.ts already make
// for short-lived per-instance state. This is belt-and-braces on top of
// the slug itself being unguessable; it bounds the cost of a single
// instance getting hammered, not a coordinated multi-IP attack (Stripe's
// own API rate limits are the real backstop for that).
const IP_WINDOW_MS = 10 * 60 * 1000
const IP_MAX = 10
const SLUG_WINDOW_MS = 10 * 60 * 1000
const SLUG_MAX = 20

const ipHits = new Map<string, number[]>()
const slugHits = new Map<string, number[]>()

function checkAndBump(store: Map<string, number[]>, key: string, windowMs: number, max: number): boolean {
  const now = Date.now()
  const hits = (store.get(key) ?? []).filter(t => now - t < windowMs)
  if (hits.length >= max) {
    store.set(key, hits)
    return false
  }
  hits.push(now)
  store.set(key, hits)
  return true
}

// Occasionally prune so these Maps don't grow unbounded across a long-warm
// instance lifetime. Cheap: only runs when a map crosses a size threshold.
function pruneIfLarge(store: Map<string, number[]>, windowMs: number) {
  if (store.size < 5000) return
  const now = Date.now()
  for (const [key, hits] of store) {
    const fresh = hits.filter(t => now - t < windowMs)
    if (fresh.length === 0) store.delete(key)
    else store.set(key, fresh)
  }
}

/** Trusted client IP — same trust order as web-token/route.ts: x-real-ip
 *  (Vercel-set) first, then the LAST x-forwarded-for hop (proxy-appended,
 *  not client-controlled), never the first (client-spoofable) entry. */
function clientIp(req: NextRequest): string {
  const real = req.headers.get('x-real-ip')?.trim()
  if (real) return real
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const parts = fwd.split(',')
    const last = parts[parts.length - 1].trim()
    if (last) return last
  }
  return 'unknown'
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  const prices = STRIPE_PRICES.demoBundle
  if (!prices.monthly || !prices.annual || !prices.setup) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }

  const ip = clientIp(req)
  pruneIfLarge(ipHits, IP_WINDOW_MS)
  pruneIfLarge(slugHits, SLUG_WINDOW_MS)
  if (!checkAndBump(ipHits, ip, IP_WINDOW_MS, IP_MAX)) {
    return NextResponse.json({ error: 'rate_limited', message: 'Too many attempts — try again in a few minutes.' }, { status: 429 })
  }
  if (!checkAndBump(slugHits, slug, SLUG_WINDOW_MS, SLUG_MAX)) {
    return NextResponse.json({ error: 'rate_limited', message: 'Too many attempts — try again in a few minutes.' }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) : ''
  const period: PurchasePeriod = body?.period === 'annual' ? 'annual' : 'monthly'

  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'invalid_email', message: 'A valid email is required.' }, { status: 400 })
  }

  const started = await startOrUpdateCheckout(slug, { period, contactEmail: email, contactName: name || null }, EXPIRES_EXTEND_MS)
  if (!started.ok) {
    if (started.reason === 'not_found') {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    if (started.reason === 'gone') {
      return NextResponse.json({ error: 'gone' }, { status: 410 })
    }
    // already_purchased
    return NextResponse.json(
      { error: 'already_purchased', message: 'This demo has already been purchased.' },
      { status: 409 },
    )
  }

  // Server-side price allowlist ONLY — the client never supplies a price
  // id. Monthly bundles the recurring price + the one-time setup fee as a
  // second line item (Stripe invoices one-time items alongside the first
  // subscription invoice); annual waives setup, so it's a single line item.
  const lineItems =
    period === 'monthly'
      ? [
          { price: prices.monthly, quantity: 1 },
          { price: prices.setup, quantity: 1 },
        ]
      : [{ price: prices.annual, quantity: 1 }]

  try {
    const session = await stripe.checkout.sessions.create({
      // Per node_modules/stripe's CHANGELOG (AGENTS.md: verify actual
      // installed API surface, not training-data assumptions) the
      // Checkout Session `ui_mode` enum on this pinned API version is
      // `elements | embedded_page | form | hosted_page` — the older
      // `embedded` value from the plan's naming has been superseded by
      // `embedded_page`. Same Embedded Checkout behavior: a `client_secret`
      // the client mounts via @stripe/react-stripe-js's
      // EmbeddedCheckoutProvider, no redirect.
      ui_mode: 'embedded_page',
      redirect_on_completion: 'never',
      mode: 'subscription',
      customer_email: email,
      line_items: lineItems,
      metadata: { intent: 'demo_bundle', prospectSlug: slug, period },
      subscription_data: {
        metadata: { intent: 'demo_bundle', prospectSlug: slug, period },
      },
    })

    // Best-effort: persist the session id so Task 3's possession check
    // works immediately. A DB hiccup here must not cost the buyer their
    // checkout session — the webhook's own `paid` transition stamps
    // stripeSessionId too, so this is belt-and-braces, not the only path.
    try {
      const row = await db.demoProspect.findUnique({ where: { id: started.prospectId }, select: { metadata: true } })
      if (row) {
        const merged = mergePurchaseMetadata(row.metadata, { stripeSessionId: session.id })
        await db.demoProspect.update({ where: { id: started.prospectId }, data: { metadata: merged as Prisma.InputJsonValue } })
      }
    } catch (err) {
      console.error(`[demo-purchase] failed to persist pending stripeSessionId for ${slug}:`, err)
    }

    return NextResponse.json({ clientSecret: session.client_secret, sessionId: session.id })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[demo-purchase] checkout-session creation failed for ${slug}:`, message)
    return NextResponse.json({ error: 'stripe_error', message: 'Could not start checkout — try again in a moment.' }, { status: 502 })
  }
}
