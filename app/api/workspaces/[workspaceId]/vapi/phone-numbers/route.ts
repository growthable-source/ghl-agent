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
    return NextResponse.json({ phoneNumber })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
}
