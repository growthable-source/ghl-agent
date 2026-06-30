import { NextRequest, NextResponse } from 'next/server'
import { validateTwilioSignature } from '@/lib/voice/gemini/twilio-signature'
import { signBridgeParams } from '@/lib/voice/gemini/signing'
import { connectStreamTwiml, sayHangupTwiml } from '@/lib/voice/gemini/twiml'

/**
 * Twilio answer webhook for the public Voice-AI "call me" demo.
 *
 * When the visitor (whose number we already SMS-verified) picks up, Twilio
 * POSTs here. We connect the call to the fixed demo agent
 * (VOICE_DEMO_AGENT_ID) via the same <Connect><Stream> → Fly bridge path
 * the inbound route uses. No number lookup — this route only ever serves
 * the demo agent.
 */

const FALLBACK = 'Sorry, the demo is not available right now. Please try again later.'

function twiml(xml: string): NextResponse {
  return new NextResponse(xml, { status: 200, headers: { 'Content-Type': 'text/xml' } })
}

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const wssUrl = process.env.GEMINI_VOICE_BRIDGE_WSS_URL
  const agentId = process.env.VOICE_DEMO_AGENT_ID
  if (!authToken || !wssUrl || !agentId) return twiml(sayHangupTwiml(FALLBACK))

  const form = await req.formData()
  const params: Record<string, string> = {}
  for (const [k, v] of form.entries()) params[k] = typeof v === 'string' ? v : ''

  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  const url = `${proto}://${host}${req.nextUrl.pathname}`
  if (!validateTwilioSignature(authToken, url, params, req.headers.get('x-twilio-signature'))) {
    return new NextResponse('forbidden', { status: 403 })
  }

  // If Twilio's answering-machine detection flagged voicemail, don't talk to a machine.
  if (params['AnsweredBy'] && params['AnsweredBy'].startsWith('machine')) {
    return twiml(sayHangupTwiml(''))
  }

  const exp = Math.floor(Date.now() / 1000) + 300
  return twiml(connectStreamTwiml({ wssUrl, signedParams: signBridgeParams({ agentId, exp }) }))
}
