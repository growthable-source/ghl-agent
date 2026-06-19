import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'
import {
  listAvailableNumbers,
  listOwnedNumbers,
  purchaseNumber,
  TwilioError,
} from '@/lib/voice/gemini/twilio'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/**
 * Agent-scoped Twilio number provisioning for Gemini voice.
 *
 *   GET  ?countryCode=US&areaCode=415  → available numbers + owned numbers
 *   POST { phoneNumber }               → buy it, wire the Voice webhook to
 *                                        our TwiML route, persist onto
 *                                        GeminiVoiceConfig.
 */

function appOrigin(req: NextRequest): string {
  const explicit = process.env.APP_URL
  if (explicit) return explicit.replace(/\/$/, '')
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  return `${proto}://${host}`
}

export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const countryCode = (req.nextUrl.searchParams.get('countryCode') || 'US').toUpperCase()
  const areaCode = req.nextUrl.searchParams.get('areaCode') || undefined

  try {
    const [available, owned] = await Promise.all([
      listAvailableNumbers({ countryCode, areaCode }),
      listOwnedNumbers(),
    ])
    return NextResponse.json({ available, owned })
  } catch (err) {
    const msg = err instanceof TwilioError ? err.userMessage : 'Failed to list numbers'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try {
    body = await req.json()
  } catch {}
  const phoneNumber = String(body.phoneNumber || '').trim()
  if (!phoneNumber) {
    return NextResponse.json({ error: 'phoneNumber (E.164) is required' }, { status: 400 })
  }

  // Confirm the agent belongs to this workspace before buying anything.
  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: 'agent not found' }, { status: 404 })

  const voiceUrl = `${appOrigin(req)}/api/voice/gemini/twilio`

  try {
    const purchased = await purchaseNumber({ phoneNumber, voiceUrl })
    await db.geminiVoiceConfig.upsert({
      where: { agentId },
      create: { agentId, twilioNumber: purchased.phoneNumber, twilioNumberSid: purchased.sid },
      update: { twilioNumber: purchased.phoneNumber, twilioNumberSid: purchased.sid },
    })
    return NextResponse.json({ number: purchased })
  } catch (err) {
    const msg = err instanceof TwilioError ? err.userMessage : 'Phone-number purchase failed'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
