import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * HMAC utilities for the Gemini phone bridge.
 *
 * One shared secret (GEMINI_VOICE_SIGNING_SECRET) guards two surfaces:
 *  - the short-lived params blob carried in TwiML <Parameter> → the
 *    bridge presents it to /api/voice/gemini/session-config, which
 *    verifies + decodes it to know which agent the call is for.
 *  - server-to-server request auth: the bridge signs each POST body to
 *    Vercel (session-config / tool / call-ended) so those endpoints
 *    trust the caller without a session cookie.
 *
 * No 'ghl'/'HighLevel' anywhere — brand-neutral, generic names.
 */

export interface BridgeParams {
  agentId: string
  exp: number // unix seconds
}

function secret(): Buffer {
  const s = process.env.GEMINI_VOICE_SIGNING_SECRET
  if (!s) throw new Error('GEMINI_VOICE_SIGNING_SECRET is not set')
  return Buffer.from(s, 'utf8')
}

function hmac(input: string): string {
  return createHmac('sha256', secret()).update(input).digest('base64url')
}

/** Constant-time string compare that never throws on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/** Sign a `{ agentId, exp }` payload → "<base64url(json)>.<base64url(hmac)>". */
export function signBridgeParams(payload: BridgeParams): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${hmac(body)}`
}

/** Verify + decode a params token. Returns null on any failure (bad sig, expiry, malformed). */
export function verifyBridgeParams(token: string): BridgeParams | null {
  if (!token || typeof token !== 'string') return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!safeEqual(sig, hmac(body))) return null
  let payload: BridgeParams
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (typeof payload?.agentId !== 'string' || typeof payload?.exp !== 'number') return null
  if (Math.floor(Date.now() / 1000) >= payload.exp) return null
  return payload
}

/** Sign a raw request body string → header value for X-Voice-Signature. */
export function signBridgeRequest(body: string): string {
  return hmac(body)
}

/** Verify a request body against the provided X-Voice-Signature header. */
export function verifyBridgeRequest(body: string, header: string | null | undefined): boolean {
  if (!header) return false
  return safeEqual(header, hmac(body))
}
