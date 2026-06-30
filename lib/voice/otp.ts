/**
 * Stateless phone-verification OTP for the public Voice-AI "call me" demo.
 *
 * The whole verification state lives in a signed, short-lived httpOnly
 * cookie — no DB table, no migration. A 6-digit code is SMS'd to the
 * number; the cookie carries the code hash + phone + attempt counter, all
 * HMAC-signed so the client can't forge it. On success we issue a separate
 * signed "verified" token that the outbound-call endpoint requires, so we
 * only ever dial a number the visitor proved they control.
 */
import { createHmac, timingSafeEqual, randomInt } from 'crypto'

export const OTP_COOKIE = 'xv_voice_otp'
export const OTP_TTL_SECS = 600 // 10 minutes
export const OTP_MAX_ATTEMPTS = 4

function secret(): string {
  const s = process.env.VOICE_DEMO_OTP_SECRET
  if (!s) throw new Error('VOICE_DEMO_OTP_SECRET is not set')
  return s
}

function hmac(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export type OtpState = {
  phone: string // E.164
  name: string
  codeHash: string
  exp: number // unix seconds
  attempts: number
}

/** "<base64url(json)>.<hmac>" */
function sign<T>(payload: T): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${hmac(body)}`
}

function verify<T>(token: string | undefined | null): T | null {
  if (!token || typeof token !== 'string') return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  if (!safeEqual(token.slice(dot + 1), hmac(body))) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (payload?.exp && Date.now() / 1000 > payload.exp) return null
    return payload as T
  } catch {
    return null
  }
}

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export function hashCode(code: string): string {
  return hmac(`code:${code}`)
}

export function signOtpState(s: OtpState): string {
  return sign(s)
}

export function readOtpState(token: string | undefined | null): OtpState | null {
  return verify<OtpState>(token)
}

/** Issued after a correct code; required by the outbound-call endpoint. */
export type VerifiedToken = { phone: string; name: string; exp: number }
export const VERIFIED_COOKIE = 'xv_voice_verified'
export const VERIFIED_TTL_SECS = 300

export function signVerified(phone: string, name: string): string {
  return sign<VerifiedToken>({ phone, name, exp: Math.floor(Date.now() / 1000) + VERIFIED_TTL_SECS })
}

export function readVerified(token: string | undefined | null): VerifiedToken | null {
  return verify<VerifiedToken>(token)
}

/**
 * Normalize to North-American E.164 (+1XXXXXXXXXX). Returns null for
 * anything that isn't a plausible US/CA mobile — we intentionally do NOT
 * dial international numbers from the public demo (premium-rate fraud).
 */
export function normalizeNaPhone(raw: string): string | null {
  const digits = (raw || '').replace(/[^\d]/g, '')
  let national = digits
  if (digits.length === 11 && digits.startsWith('1')) national = digits.slice(1)
  if (national.length !== 10) return null
  // NANP: area code + exchange both start 2-9.
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) return null
  return `+1${national}`
}
