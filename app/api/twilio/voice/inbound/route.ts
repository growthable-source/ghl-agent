import { NextRequest } from 'next/server'

/**
 * POST /api/twilio/voice/inbound
 *
 * PHASE 2 SCAFFOLD — inbound PSTN call webhook from Twilio.
 *
 * Returns TwiML that opens a Media Streams WebSocket pointing at the
 * bridge service. The bridge then:
 *   - opens wss://api.x.ai/v1/realtime with a freshly-minted ephemeral key
 *   - transcodes Twilio μ-law 8kHz ↔ XAI PCM16 24kHz in both directions
 *   - streams audio between the two WebSockets in real time
 *
 * This endpoint itself is cheap — it just returns TwiML on each call
 * start. The actual audio plumbing runs in a separate persistent-WS
 * service (see docs/voice-bridge.md) because Vercel's serverless
 * functions can't hold the WebSocket for the duration of a phone call.
 *
 * Until the bridge service is deployed, this endpoint returns a polite
 * "voice not yet configured" message so misrouted calls don't hang.
 */
export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const toNumber = (formData.get('To') as string) || ''
  const fromNumber = (formData.get('From') as string) || ''

  const bridgeUrl = process.env.VOICE_BRIDGE_WSS_URL  // e.g. wss://bridge.voxility.ai
  if (!bridgeUrl) {
    // TwiML polite fallback — caller hears the message, call ends cleanly.
    const fallback = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">This line is being set up. Please try again soon.</Say>
  <Hangup/>
</Response>`
    return new Response(fallback, { headers: { 'Content-Type': 'text/xml' } })
  }

  // Media Streams TwiML — Twilio opens a bi-directional WS to the bridge.
  // Custom parameters (to/from number) flow to the bridge as `Stream.Start`
  // metadata so it can resolve which agent + voice to use.
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${bridgeUrl}">
      <Parameter name="to" value="${toNumber}" />
      <Parameter name="from" value="${fromNumber}" />
    </Stream>
  </Connect>
</Response>`

  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
