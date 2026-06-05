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
 *   POST  buy a new number — body { areaCode }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { listPhoneNumbers, purchasePhoneNumber } from '@/lib/vapi-client'

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
  const areaCode = String(body.areaCode || '').replace(/\D/g, '').slice(0, 3)
  if (!areaCode) {
    return NextResponse.json({ error: 'areaCode (3 digits) is required' }, { status: 400 })
  }

  try {
    const phoneNumber = await purchasePhoneNumber(areaCode)
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
