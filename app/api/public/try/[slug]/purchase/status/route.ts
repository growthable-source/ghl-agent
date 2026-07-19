/**
 * GET /api/public/try/[slug]/purchase/status?session_id=...
 *
 * Public, unauthenticated polling endpoint for PurchaseModal step 3
 * ("creating your account") and everything after it. Possession check:
 * the projection is only ever returned when `session_id` matches the
 * prospect's stored `purchase.stripeSessionId` — the /try/[slug] link is
 * shareable, so the slug alone must never expose whether (or what)
 * someone purchased. checkout-session/route.ts stamps stripeSessionId
 * onto purchase metadata the moment the Stripe Checkout Session is
 * created (before payment), so this match works from the very first
 * poll, not just after the webhook lands.
 *
 * projectPurchase() (lib/demo-purchase/state.ts) already strips every
 * PII/internal field (email, Stripe ids, userId/workspaceId/locationId) —
 * this route is a thin, read-only wrapper around it. No rate cap: cheap
 * DB read, and the session_id possession check already bounds who can
 * usefully call it.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getPurchase, projectPurchase } from '@/lib/demo-purchase/state'

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const sessionId = req.nextUrl.searchParams.get('session_id')?.trim() || ''
  if (!sessionId) {
    return NextResponse.json({ error: 'missing_session_id' }, { status: 400 })
  }

  const prospect = await db.demoProspect.findUnique({ where: { slug }, select: { metadata: true } })
  if (!prospect) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const purchase = getPurchase(prospect.metadata)
  if (!purchase || !purchase.stripeSessionId) {
    // No purchase started yet (or the pre-payment stamp somehow never
    // landed) — nothing to show, and nothing to distinguish this from
    // "wrong slug" without leaking more than a shared link should.
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (purchase.stripeSessionId !== sessionId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  return NextResponse.json({ purchase: projectPurchase(purchase) })
}
