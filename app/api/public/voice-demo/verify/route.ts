/**
 * Public Voice-AI demo — step 2: verify the code, then call the visitor.
 *
 * Reads the signed OTP cookie set by /start, checks the 6-digit code
 * (capped attempts), and on success places an outbound Twilio call to the
 * now-verified number. Twilio fetches TwiML from /outbound-answer, which
 * connects the call to the demo voice agent.
 *
 *   POST { code } -> { ok, calling: true } | { error, attemptsLeft? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { isOutboundVoiceConfigured, placeCall } from '@/lib/voice/gemini/twilio'
import {
  OTP_COOKIE, OTP_MAX_ATTEMPTS, VERIFIED_COOKIE, VERIFIED_TTL_SECS,
  readOtpState, hashCode, signOtpState, signVerified,
} from '@/lib/voice/otp'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

function publicOrigin(req: NextRequest): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '')
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '')
  const proto = req.headers.get('x-forwarded-proto') ?? 'https'
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  return `${proto}://${host}`
}

export async function POST(req: NextRequest) {
  // The voice agent + bridge must be wired for the call to connect to anything.
  if (!isOutboundVoiceConfigured() || !process.env.VOICE_DEMO_AGENT_ID || !process.env.GEMINI_VOICE_BRIDGE_WSS_URL) {
    return NextResponse.json({ error: "The live call demo isn't available right now." }, { status: 503, headers: CORS })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const code = typeof body.code === 'string' ? body.code.replace(/[^\d]/g, '').slice(0, 6) : ''

  const state = readOtpState(req.cookies.get(OTP_COOKIE)?.value)
  if (!state) {
    return NextResponse.json({ error: 'Your code expired — start again.' }, { status: 400, headers: CORS })
  }

  if (code.length !== 6 || hashCode(code) !== state.codeHash) {
    const attempts = state.attempts + 1
    const attemptsLeft = OTP_MAX_ATTEMPTS - attempts
    if (attemptsLeft <= 0) {
      const res = NextResponse.json({ error: 'Too many tries — start again.' }, { status: 429, headers: CORS })
      res.cookies.delete(OTP_COOKIE)
      return res
    }
    const res = NextResponse.json({ error: 'That code is incorrect.', attemptsLeft }, { status: 400, headers: CORS })
    res.cookies.set(OTP_COOKIE, signOtpState({ ...state, attempts }), {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: Math.max(0, state.exp - Math.floor(Date.now() / 1000)),
    })
    return res
  }

  // Verified — place the call.
  try {
    await placeCall({ to: state.phone, answerUrl: `${publicOrigin(req)}/api/voice/gemini/outbound-answer` })
  } catch (err) {
    console.error('[voice-demo/verify] call failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "We verified you, but couldn't start the call. Try again shortly." }, { status: 502, headers: CORS })
  }

  const res = NextResponse.json({ ok: true, calling: true }, { headers: CORS })
  res.cookies.delete(OTP_COOKIE)
  res.cookies.set(VERIFIED_COOKIE, signVerified(state.phone, state.name), {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: VERIFIED_TTL_SECS,
  })
  return res
}
