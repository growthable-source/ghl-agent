/**
 * Public Voice-AI demo — step 1: request a verification code.
 *
 * Visitor submits name + phone; we SMS a 6-digit code and stash the
 * verification state in a signed httpOnly cookie (see lib/voice/otp.ts).
 * We only ever call a number the visitor proves they control, so this
 * gate exists to stop the "call me" demo being used to robo-dial
 * strangers or premium-rate numbers.
 *
 *   POST { name, phone } -> { ok: true } | { error }
 *
 * Dormant (503) until Twilio creds + a voice "From" number are set.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isOutboundVoiceConfigured, sendSms } from '@/lib/voice/gemini/twilio'
import { OTP_COOKIE, OTP_TTL_SECS, generateCode, hashCode, signOtpState, normalizeNaPhone } from '@/lib/voice/otp'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(req: NextRequest) {
  if (!isOutboundVoiceConfigured()) {
    return NextResponse.json(
      { error: "Our live call demo isn't switched on yet — leave your details and we'll call you shortly." },
      { status: 503, headers: CORS },
    )
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
  const phone = normalizeNaPhone(typeof body.phone === 'string' ? body.phone : '')

  if (name.length < 2) return NextResponse.json({ error: 'Please enter your name.' }, { status: 400, headers: CORS })
  if (!phone) return NextResponse.json({ error: 'Enter a valid US or Canada mobile number.' }, { status: 400, headers: CORS })

  const code = generateCode()
  try {
    await sendSms({
      to: phone,
      body: `Your Xovera demo code is ${code}. Enter it and our AI will call you right back.`,
    })
  } catch (err) {
    console.error('[voice-demo/start] sms failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "We couldn't text that number — double-check it and try again." }, { status: 502, headers: CORS })
  }

  const state = signOtpState({
    phone,
    name,
    codeHash: hashCode(code),
    exp: Math.floor(Date.now() / 1000) + OTP_TTL_SECS,
    attempts: 0,
  })

  const res = NextResponse.json({ ok: true, sentTo: phone.replace(/\d(?=\d{4})/g, '•') }, { headers: CORS })
  res.cookies.set(OTP_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: OTP_TTL_SECS,
  })
  return res
}
