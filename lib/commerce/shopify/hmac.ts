/**
 * Shopify HMAC verification.
 *
 * Shopify signs two distinct things with the app's client secret, and
 * they use different encodings — keeping them separate avoids the
 * classic "I verified the wrong thing" footgun.
 *
 *   verifyOAuthCallbackHmac()
 *     OAuth redirect from Shopify -> /api/auth/shopify/callback.
 *     Signature: HMAC-SHA256 over the URL query string with the `hmac`
 *     param removed and remaining params sorted alphabetically (joined
 *     as `key=value&key=value`). Encoded as lowercase hex. Sent in the
 *     `hmac` query param.
 *
 *   verifyWebhookHmac()
 *     Webhook POST from Shopify -> /api/webhooks/shopify/*.
 *     Signature: HMAC-SHA256 over the raw request body (bytes, NOT
 *     parsed/re-serialised). Encoded as base64. Sent in the
 *     `X-Shopify-Hmac-Sha256` request header.
 *
 * Both use timingSafeEqual to avoid leaking the secret via comparison
 * timing.
 *
 * Plus signState/verifyState for our own OAuth CSRF token — we sign the
 * `state` we send to Shopify so the callback can verify it came from us
 * (Shopify echoes whatever state we send back unchanged, so without our
 * own signature, anyone could craft a callback URL with a guessed
 * workspaceId and have us bind a hostile shop to that workspace).
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'

const SECRET = () => {
  const s = process.env.SHOPIFY_API_SECRET
  if (!s) throw new Error('SHOPIFY_API_SECRET not configured')
  return s
}

// Used to sign our OAuth state token. Reusing PORTAL_SESSION_SECRET
// keeps the set of long-lived secrets small; it's already present in
// every environment and is HMAC-grade entropy.
const STATE_SECRET = () => {
  const s = process.env.PORTAL_SESSION_SECRET
  if (!s) throw new Error('PORTAL_SESSION_SECRET not configured')
  return s
}

/**
 * Verify the `hmac` query param on Shopify's OAuth callback.
 *
 * Pass the URLSearchParams (or any iterable of [key, value] pairs) as
 * Shopify sent them — we strip `hmac` and sort the rest before signing.
 */
export function verifyOAuthCallbackHmac(params: URLSearchParams): boolean {
  const provided = params.get('hmac')
  if (!provided) return false

  // Build the canonical message: sorted, hmac-stripped, key=value&...
  // Shopify's docs are clear that values are NOT URL-decoded for this
  // check — use the raw string form they sent.
  const pairs: string[] = []
  for (const [k, v] of params.entries()) {
    if (k === 'hmac' || k === 'signature') continue
    pairs.push(`${k}=${v}`)
  }
  pairs.sort()
  const message = pairs.join('&')

  const expected = createHmac('sha256', SECRET()).update(message).digest('hex')

  return safeHexEqual(expected, provided)
}

/**
 * Verify a webhook payload.
 *
 * IMPORTANT: pass the RAW request body bytes/string — not a parsed and
 * re-serialised object. Re-serialisation changes whitespace and key
 * order, breaking the signature.
 */
export function verifyWebhookHmac(
  rawBody: string | Buffer,
  headerHmac: string | null,
): boolean {
  if (!headerHmac) return false
  const expected = createHmac('sha256', SECRET()).update(rawBody).digest('base64')
  return safeBase64Equal(expected, headerHmac)
}

// ─── OAuth state signing (CSRF protection) ──────────────────────────
//
// State format: base64url(`${workspaceId}.${nonce}.${timestamp}`) + "." + sig
// where sig = HMAC-SHA256(payload, STATE_SECRET) base64url.
//
// Timestamp window: 10 minutes. Anything older is rejected — a leaked
// state token can't be replayed once a user has finished a different
// flow.

const STATE_MAX_AGE_MS = 10 * 60 * 1000

export function signState(workspaceId: string): string {
  const nonce = randomBytes(16).toString('base64url')
  const payload = `${workspaceId}.${nonce}.${Date.now()}`
  const sig = createHmac('sha256', STATE_SECRET()).update(payload).digest('base64url')
  return `${Buffer.from(payload).toString('base64url')}.${sig}`
}

export interface VerifiedState {
  workspaceId: string
  nonce: string
  issuedAt: number
}

export function verifyState(state: string | null): VerifiedState | null {
  if (!state) return null
  const dot = state.lastIndexOf('.')
  if (dot < 0) return null

  const payloadB64 = state.slice(0, dot)
  const providedSig = state.slice(dot + 1)

  let payload: string
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8')
  } catch {
    return null
  }

  const expectedSig = createHmac('sha256', STATE_SECRET()).update(payload).digest('base64url')
  if (!safeAsciiEqual(expectedSig, providedSig)) return null

  const [workspaceId, nonce, tsStr] = payload.split('.')
  if (!workspaceId || !nonce || !tsStr) return null
  const issuedAt = Number(tsStr)
  if (!Number.isFinite(issuedAt)) return null
  if (Date.now() - issuedAt > STATE_MAX_AGE_MS) return null

  return { workspaceId, nonce, issuedAt }
}

// ─── Constant-time comparison helpers ───────────────────────────────
// timingSafeEqual throws on length mismatch — wrap it so callers can
// just get a boolean. Length mismatch is itself a non-match, which is
// safe to return without timing concern (the length is observable in
// the network response anyway).

function safeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

function safeBase64Equal(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'base64'), Buffer.from(b, 'base64'))
  } catch {
    return false
  }
}

function safeAsciiEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}
