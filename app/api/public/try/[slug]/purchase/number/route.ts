/**
 * POST /api/public/try/[slug]/purchase/number
 * Body: { session_id: string, number?: string, skip?: boolean }
 *
 * PurchaseModal step 4 action: buy the number the visitor picked, or
 * explicitly defer to the concierge with `skip: true`. Same session_id
 * possession check as status/numbers (see status/route.ts's doc
 * comment).
 *
 * CAS `crm_ready` → `number_purchasing` before touching the adapter, so
 * a double-POST (network retry, double-click) can't race two purchase
 * attempts: the loser's CAS fails, advancePurchaseState hands back the
 * fresh state instead of clobbering the winner's write, and this route
 * just reports whatever that fresh state is. Once state has moved past
 * `crm_ready` for ANY reason (including a prior call on this same route)
 * a re-POST is idempotent — it returns the current projection instead of
 * re-attempting a purchase or erroring.
 *
 * After settling number_purchased/number_failed/number_deferred, this
 * calls completeDemoPurchase() (lib/demo-purchase/fulfill.ts) to advance
 * to `complete` and send the magic-link sign-in email — the webhook
 * itself returns early at crm_ready/number_purchasing (see
 * fulfillDemoBundle's doc comment) since the buyer's number choice
 * happens well after that invocation already finished, so this route is
 * what actually finishes the job.
 *
 * IMPORTANT: the JSON response is built from the number_purchased /
 * number_failed / number_deferred projection CAPTURED BEFORE calling
 * completeDemoPurchase() — not re-read afterward. projectPurchase()
 * (lib/demo-purchase/state.ts) only ever surfaces `phoneNumber` while
 * `state === 'number_purchased'` exactly (see state.test.ts's "only
 * surfaces phoneNumber once state is number_purchased" — that gate is
 * intentional and must not change); since completeDemoPurchase advances
 * straight through to `complete` in the same request, re-reading fresh
 * state afterward would silently drop the phone number from the very
 * response meant to hand it to the buyer. PurchaseModal's step 5 should
 * read `phoneNumber` off THIS response and hold it in local UI state — a
 * later status-route poll will correctly show `phoneNumber: null` once
 * state has moved to `complete`, by design.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { advancePurchaseState, getPurchase, projectPurchase, type PurchaseState } from '@/lib/demo-purchase/state'
import { completeDemoPurchase } from '@/lib/demo-purchase/fulfill'
import { flagConcierge } from '@/lib/demo-purchase/concierge'
import { purchaseNumber, LeadConnectorError, LeadConnectorNotConfiguredError } from '@/lib/leadconnector/agency-provisioning'

const TERMINAL_STATES: PurchaseState[] = ['number_purchased', 'number_failed', 'number_deferred', 'complete']

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const body = await req.json().catch(() => ({}))
  const sessionId = typeof body?.session_id === 'string' ? body.session_id.trim() : ''
  const number = typeof body?.number === 'string' ? body.number.trim() : ''
  const skip = body?.skip === true

  if (!sessionId) return NextResponse.json({ error: 'missing_session_id' }, { status: 400 })
  if (!skip && !number) {
    return NextResponse.json({ error: 'invalid_request', message: 'Provide a number or set skip: true.' }, { status: 400 })
  }

  const prospect = await db.demoProspect.findUnique({ where: { slug } })
  if (!prospect) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const purchase = getPurchase(prospect.metadata)
  if (!purchase || !purchase.stripeSessionId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (purchase.stripeSessionId !== sessionId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Idempotent re-POST: already past the number step (or all the way to
  // complete, e.g. a prior request already ran completeDemoPurchase) —
  // hand back the current projection instead of erroring or re-purchasing.
  if (TERMINAL_STATES.includes(purchase.state)) {
    return NextResponse.json({ purchase: projectPurchase(purchase) })
  }

  if (purchase.state !== 'crm_ready') {
    // Not there yet (still provisioning), or another concurrent request
    // already claimed number_purchasing — surface the current state; the
    // client's existing status-poll loop handles the "wait" UX.
    return NextResponse.json({ error: 'not_ready', state: purchase.state }, { status: 409 })
  }

  const claimed = await advancePurchaseState(prospect.id, 'crm_ready', 'number_purchasing', {})
  if (!claimed.ok) {
    // Lost the CAS race — a concurrent POST (retry/double-click) already
    // claimed this stage. Report whatever it landed on rather than
    // attempting a second purchase.
    return NextResponse.json({ purchase: projectPurchase(claimed.purchase) })
  }
  const inFlight = claimed.purchase!

  if (skip) {
    const deferred = await advancePurchaseState(prospect.id, 'number_purchasing', 'number_deferred', {})
    const responseProjection = projectPurchase(deferred.purchase ?? inFlight)
    await completeDemoPurchase(slug) // advances to complete + sends the magic link; doesn't affect this response
    return NextResponse.json({ purchase: responseProjection })
  }

  if (!inFlight.locationId) {
    // Defensive only: crm_ready should never lack a locationId (it's set
    // in the same write that sets state to crm_ready). Treat it as a
    // provisioning failure rather than crashing the request.
    await flagConcierge(slug, 'number_purchase', 'number_purchasing but no locationId was recorded on the purchase.')
    const failed = await advancePurchaseState(prospect.id, 'number_purchasing', 'number_failed', {})
    const responseProjection = projectPurchase(failed.purchase ?? inFlight)
    await completeDemoPurchase(slug)
    return NextResponse.json({ purchase: responseProjection })
  }

  let responseProjection: ReturnType<typeof projectPurchase>
  try {
    await purchaseNumber(inFlight.locationId, number)
    const purchased = await advancePurchaseState(prospect.id, 'number_purchasing', 'number_purchased', { phoneNumber: number })
    responseProjection = projectPurchase(purchased.purchase ?? inFlight)
  } catch (err) {
    const message =
      err instanceof LeadConnectorError ? err.userMessage
      : err instanceof LeadConnectorNotConfiguredError ? err.message
      : err instanceof Error ? err.message : String(err)
    console.error(`[demo-purchase] number purchase failed for ${slug}:`, message)
    await flagConcierge(slug, 'number_purchase', message)
    const failed = await advancePurchaseState(prospect.id, 'number_purchasing', 'number_failed', {})
    responseProjection = projectPurchase(failed.purchase ?? inFlight)
  }

  await completeDemoPurchase(slug) // advances to complete + sends the magic link; doesn't affect this response
  return NextResponse.json({ purchase: responseProjection })
}
