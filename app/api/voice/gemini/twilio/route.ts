import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { validateTwilioSignature } from '@/lib/voice/gemini/twilio-signature'
import { signBridgeParams } from '@/lib/voice/gemini/signing'
import { connectStreamTwiml, sayHangupTwiml } from '@/lib/voice/gemini/twiml'

/**
 * Twilio inbound voice webhook for Gemini phone agents.
 *
 * 1. Validate X-Twilio-Signature against the form body + the exact URL
 *    Twilio called (must match the configured VoiceUrl, including https).
 * 2. Resolve which agent owns the dialled number (To → GeminiVoiceConfig).
 * 3. Return <Connect><Stream> pointing at the Fly bridge, carrying a
 *    short-lived signed params blob. The bridge presents that blob to
 *    /api/voice/gemini/session-config to learn which agent to run.
 *
 * On any miss (unknown number, inactive config) → a brand-neutral
 * <Say><Hangup>. Never dead-air.
 */

const FALLBACK_MESSAGE = 'Sorry, this number is not available right now. Please try again later.'

function twimlResponse(xml: string): NextResponse {
  return new NextResponse(xml, { status: 200, headers: { 'Content-Type': 'text/xml' } })
}

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const wssUrl = process.env.GEMINI_VOICE_BRIDGE_WSS_URL
  if (!authToken || !wssUrl) {
    return twimlResponse(sayHangupTwiml(FALLBACK_MESSAGE))
  }

  // Twilio posts application/x-www-form-urlencoded.
  const form = await req.formData()
  const params: Record<string, string> = {}
  for (const [k, v] of form.entries()) params[k] = typeof v === 'string' ? v : ''

  // Reconstruct the URL Twilio signed. Trust the proxy host so the
  // string matches the configured VoiceUrl exactly.
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  const url = `${proto}://${host}${req.nextUrl.pathname}`

  const sig = req.headers.get('x-twilio-signature')
  if (!validateTwilioSignature(authToken, url, params, sig)) {
    // Reject unsigned/forged callbacks.
    return new NextResponse('forbidden', { status: 403 })
  }

  const to = params['To'] ?? ''
  if (!to) return twimlResponse(sayHangupTwiml(FALLBACK_MESSAGE))

  const config = await db.geminiVoiceConfig.findFirst({
    where: { twilioNumber: to, isActive: true },
    select: { agentId: true },
  })
  if (!config?.agentId) {
    return twimlResponse(sayHangupTwiml(FALLBACK_MESSAGE))
  }

  // 5-minute params window — far longer than answer latency, short
  // enough that a leaked blob is near-worthless.
  const exp = Math.floor(Date.now() / 1000) + 300
  const signed = signBridgeParams({ agentId: config.agentId, exp })

  return twimlResponse(connectStreamTwiml({ wssUrl, signedParams: signed }))
}
