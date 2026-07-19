/**
 * POST /api/public/try/[slug]/purchase/resend-link
 * Body: { session_id: string }
 *
 * Re-mints and re-sends the post-purchase magic-sign-in link
 * (lib/demo-purchase/magic-link.ts) for a buyer who never got — or lost —
 * the original email sent from completeDemoPurchase()
 * (lib/demo-purchase/fulfill.ts). Wired to the "Resend email" button on
 * PurchaseModal step 5 (app/try/[slug]/sections/purchase/StepDone.tsx).
 *
 * Same session_id possession check as status/numbers/number (see
 * status/route.ts's doc comment) — the /try/[slug] link is shareable, so
 * the slug alone must never let a stranger trigger emails to the buyer's
 * inbox or learn whether/what they purchased.
 *
 * Requires purchase.state to be `claimed` or later — that's the point at
 * which userId/workspaceId/contactEmail are all guaranteed to already be
 * set (see fulfill.ts's paid→account_ready→claimed transitions), so
 * there's always something valid to mint a link for. Earlier states
 * (checkout_started, paid, account_ready) have nothing to sign in to
 * yet — StepProvisioning's existing poll loop covers that wait, so this
 * route just reports 409 rather than trying to be a second progress
 * indicator.
 *
 * Rate caps — both best-effort metadata counters (re-read+merge like
 * every other write in this module; see state.ts's mergePurchaseMetadata
 * doc), same soft-under-a-lost-race posture as numbers/route.ts's
 * numberSearchCount: a slightly-over-cap resend is an acceptable
 * outcome, blocking a legitimate buyer is not.
 *   - max 3 explicit resends per prospect (purchase.resendCount)
 *   - 120s cooldown since the LAST send, original or resend
 *     (purchase.magicLinkSentAt — completeDemoPurchase's original send
 *     stamps this too, so clicking "resend" seconds after the automatic
 *     email lands still respects the cooldown)
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getPurchase, mergePurchaseMetadata, type PurchaseState } from '@/lib/demo-purchase/state'
import { createMagicLinkToken, sendMagicLinkEmail } from '@/lib/demo-purchase/magic-link'
import { flagConcierge } from '@/lib/demo-purchase/concierge'

const MAX_RESENDS = 3
const COOLDOWN_MS = 120_000
const NOT_YET_CLAIMED: PurchaseState[] = ['checkout_started', 'paid', 'account_ready']

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const body = await req.json().catch(() => ({}))
  const sessionId = typeof body?.session_id === 'string' ? body.session_id.trim() : ''
  if (!sessionId) return NextResponse.json({ error: 'missing_session_id' }, { status: 400 })

  const prospect = await db.demoProspect.findUnique({ where: { slug } })
  if (!prospect) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const purchase = getPurchase(prospect.metadata)
  if (!purchase || !purchase.stripeSessionId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (purchase.stripeSessionId !== sessionId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (NOT_YET_CLAIMED.includes(purchase.state)) {
    return NextResponse.json({ error: 'not_ready', state: purchase.state }, { status: 409 })
  }
  if (!purchase.userId || !purchase.workspaceId || !purchase.contactEmail) {
    // Defensive only — claimed-or-later should always carry all three
    // (see fulfill.ts). Route to concierge rather than silently failing.
    await flagConcierge(slug, 'resend_link', 'Resend requested but userId/workspaceId/contactEmail missing at a claimed-or-later state.')
    return NextResponse.json(
      { error: 'unavailable', message: "Couldn't resend right now — our team has been notified and will follow up by email." },
      { status: 500 },
    )
  }

  const resendCount = purchase.resendCount ?? 0
  if (resendCount >= MAX_RESENDS) {
    return NextResponse.json(
      { error: 'rate_limited', message: "You've reached the resend limit — email support@xovera.io and we'll get you signed in." },
      { status: 429 },
    )
  }
  if (purchase.magicLinkSentAt) {
    const elapsedMs = Date.now() - new Date(purchase.magicLinkSentAt).getTime()
    if (elapsedMs < COOLDOWN_MS) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Give it a moment before requesting another email.', retryAfterMs: COOLDOWN_MS - elapsedMs },
        { status: 429 },
      )
    }
  }

  try {
    const rawToken = await createMagicLinkToken(purchase.userId, purchase.workspaceId)
    const base = (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://xovera.io').replace(/\/$/, '')
    const magicLinkUrl = `${base}/welcome/${rawToken}`
    await sendMagicLinkEmail({ to: purchase.contactEmail, businessName: prospect.businessName, magicLinkUrl })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[demo-purchase] resend-link send failed for ${slug}:`, message)
    await flagConcierge(slug, 'resend_link', message || 'unknown error resending the magic-link email')
    return NextResponse.json({ error: 'send_failed', message: 'Could not send the email right now — try again in a moment.' }, { status: 502 })
  }

  // Best-effort counter bump — a lost race under a rapid double-click just
  // makes the cap slightly soft (same posture as numbers/route.ts's
  // numberSearchCount); the email has already sent either way, so this
  // must never turn into an error response for the buyer.
  await db.demoProspect
    .update({
      where: { id: prospect.id },
      data: {
        metadata: mergePurchaseMetadata(prospect.metadata, {
          resendCount: resendCount + 1,
          magicLinkSentAt: new Date().toISOString(),
        }) as Prisma.InputJsonValue,
      },
    })
    .catch(err => console.error(`[demo-purchase] resend-link counter bump failed for ${slug}:`, err))

  return NextResponse.json({ ok: true })
}
