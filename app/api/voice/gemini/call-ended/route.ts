import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyBridgeRequest } from '@/lib/voice/gemini/signing'

/**
 * Sink for end-of-call telemetry from the Fly bridge. HMAC-authed (the
 * bridge signs the raw body with the shared secret). Writes one CallLog
 * row per inbound Gemini phone call. Recording upload is a follow-up;
 * the transcript is the load-bearing artifact and is always persisted.
 */
interface CallEndedBody {
  agentId: string
  locationId: string
  callSid: string
  from: string
  to: string
  durationSecs: number
  transcript: string
  endedReason?: string
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!verifyBridgeRequest(raw, req.headers.get('x-voice-signature'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let body: CallEndedBody
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  if (!body.agentId || !body.locationId) {
    return NextResponse.json({ error: 'missing agentId/locationId' }, { status: 400 })
  }

  await db.callLog.create({
    data: {
      locationId: body.locationId,
      agentId: body.agentId,
      contactPhone: body.from || null,
      direction: 'inbound',
      status: 'completed',
      durationSecs: Number.isFinite(body.durationSecs) ? Math.round(body.durationSecs) : null,
      transcript: body.transcript || null,
      endedReason: body.endedReason || null,
      triggerSource: 'gemini-voice-phone',
    },
  })

  return NextResponse.json({ ok: true })
}
