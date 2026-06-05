/**
 * Workspace-scoped phone-number endpoints.
 *
 * Pre-dates the agent-scoped variant at
 * /api/workspaces/[wsId]/agents/[agentId]/vapi/route.ts so the voice
 * wizard (which buys a number BEFORE the agent exists) has a place to
 * call. Same underlying lib/vapi-client.ts primitives, just no
 * agent-FK lookup.
 *
 *   GET   list every Vapi-provisioned number on this workspace's Vapi account
 *   POST  buy a new number — body { countryCode, areaCode?, name? }
 *           countryCode  ISO-3166 alpha-2 (default 'US')
 *           areaCode     optional regional code; US wants 3 digits,
 *                        AU/GB are 2-3, etc.
 *           name         friendly label on Vapi's side
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import {
  listPhoneNumbers,
  purchasePhoneNumber,
  VAPI_PURCHASEABLE_COUNTRIES,
  type VapiPurchaseableCountry,
} from '@/lib/vapi-client'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  try {
    const numbers = await listPhoneNumbers()
    return NextResponse.json({ phoneNumbers: numbers })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {}
  const rawCountry = String(body.countryCode || 'US').toUpperCase()
  if (!VAPI_PURCHASEABLE_COUNTRIES.includes(rawCountry as VapiPurchaseableCountry)) {
    return NextResponse.json(
      { error: `countryCode must be one of ${VAPI_PURCHASEABLE_COUNTRIES.join(', ')}` },
      { status: 400 },
    )
  }
  const countryCode = rawCountry as VapiPurchaseableCountry
  // Area code is optional outside the US — Vapi will pick any available
  // number in the country if it's omitted. US still validates 3 digits
  // to preserve the old wizard contract.
  const areaCodeRaw = String(body.areaCode || '').replace(/\D/g, '')
  const areaCode = countryCode === 'US' ? areaCodeRaw.slice(0, 3) : areaCodeRaw.slice(0, 4)
  if (countryCode === 'US' && !areaCode) {
    return NextResponse.json({ error: 'areaCode (3 digits) is required for US numbers' }, { status: 400 })
  }

  try {
    const phoneNumber = await purchasePhoneNumber({ countryCode, areaCode: areaCode || undefined })
    // Wizard expects { phoneNumber: { id, number, name } } — match that
    // shape verbatim so the client can use the result without massaging.
    // Wizard also wants to show an "activating, 1-2 min" notice so the
    // user knows not to dial immediately; include the hint here.
    return NextResponse.json({
      phoneNumber,
      activatingHint: 'Carrier wire-up takes 30 seconds to 2 minutes. The Try-it dial may fail on the first attempt right after purchase.',
    })
  } catch (err: any) {
    const message = err?.userMessage || err?.message || 'Vapi phone-number purchase failed'
    const code = err?.code === 'string' ? err.code : undefined
    return NextResponse.json({ error: message, code }, { status: 400 })
  }
}
