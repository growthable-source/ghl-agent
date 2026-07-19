/**
 * GET /api/public/try/[slug]/purchase/numbers?areaCode=&session_id=
 *
 * Area-code phone-number search for PurchaseModal step 4 ("pick your
 * number"). Same session_id possession check as status/route.ts (see
 * that file's doc comment). Requires the purchase to have reached
 * `crm_ready` — a LeadConnector sub-account must exist before there's
 * anything to search into.
 *
 * Rate cap: ~20 searches per prospect, counted via a metadata counter
 * (purchase.numberSearchCount, lib/demo-purchase/state.ts) rather than
 * per-IP — the slug + session_id pair is already an unguessable
 * credential, and per-IP would wrongly punish a shared office network.
 *
 * Adapter not configured → 409 {code:'not_available'} so the client can
 * show "our team will finish picking a number for you" and fall straight
 * to the skip path — never a hard error mid-checkout.
 */
import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getPurchase, mergePurchaseMetadata } from '@/lib/demo-purchase/state'
import { isLeadConnectorConfigured, searchAvailableNumbers, LeadConnectorError, LeadConnectorNotConfiguredError } from '@/lib/leadconnector/agency-provisioning'

const AREA_CODE_RE = /^\d{2,4}$/
const MAX_SEARCHES = 20

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const sessionId = req.nextUrl.searchParams.get('session_id')?.trim() || ''
  const areaCode = req.nextUrl.searchParams.get('areaCode')?.trim() || ''

  if (!sessionId) {
    return NextResponse.json({ error: 'missing_session_id' }, { status: 400 })
  }
  if (!AREA_CODE_RE.test(areaCode)) {
    return NextResponse.json({ error: 'invalid_area_code', message: 'Enter a 2-4 digit area code.' }, { status: 400 })
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

  if (purchase.state !== 'crm_ready' || !purchase.locationId) {
    return NextResponse.json({ error: 'not_ready', state: purchase.state }, { status: 409 })
  }

  if (!isLeadConnectorConfigured()) {
    return NextResponse.json({ error: 'not_available', code: 'not_available' }, { status: 409 })
  }

  const searchCount = purchase.numberSearchCount ?? 0
  if (searchCount >= MAX_SEARCHES) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many searches — our team will finish picking a number with you.' },
      { status: 429 },
    )
  }

  try {
    const numbers = await searchAvailableNumbers(areaCode, purchase.locationId)

    // Best-effort counter bump — a lost race under concurrent polling just
    // makes the cap slightly soft; it must never block a legitimate
    // result the adapter already fetched.
    await db.demoProspect
      .update({
        where: { id: prospect.id },
        data: { metadata: mergePurchaseMetadata(prospect.metadata, { numberSearchCount: searchCount + 1 }) as Prisma.InputJsonValue },
      })
      .catch(err => console.error(`[demo-purchase] numbers search-count bump failed for ${slug}:`, err))

    return NextResponse.json({ numbers })
  } catch (err) {
    if (err instanceof LeadConnectorNotConfiguredError) {
      return NextResponse.json({ error: 'not_available', code: 'not_available' }, { status: 409 })
    }
    if (err instanceof LeadConnectorError) {
      console.error(`[demo-purchase] number search failed for ${slug}:`, err.userMessage)
      return NextResponse.json({ error: 'search_failed', message: 'Could not search numbers right now — try again in a moment.' }, { status: 502 })
    }
    throw err
  }
}
