/**
 * Verify the X-Hub-Signature-256 header on Meta webhook deliveries.
 *
 * Meta signs every webhook POST body with HMAC-SHA256 using the App
 * Secret. The signature arrives as the header value
 *   "sha256=<lowercase hex>"
 * and we compute the same digest over the raw, byte-exact request body
 * and compare in constant time. The raw body matters — re-stringifying
 * a parsed JSON body changes whitespace and breaks the comparison.
 *
 * Treat verification as ALL-OR-NOTHING: any failure (missing header,
 * wrong prefix, length mismatch, hex parse fail, digest mismatch)
 * returns false. Callers should respond 401 and never read the body
 * further. Otherwise the route becomes a free-fire RCE-shaped surface
 * where anyone can post fake "messages" claiming to be from any user.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string }

const PREFIX = 'sha256='

/**
 * @param rawBody  The exact request body bytes (do NOT use a parsed JSON
 *                 then re-stringify — the resulting whitespace differs).
 *                 Pass `Buffer` or `string` (UTF-8 encoded).
 * @param signatureHeader  The full value of the `X-Hub-Signature-256`
 *                 header, e.g. "sha256=ab12...".
 * @param appSecret  The Meta App Secret for the app receiving the
 *                 webhook. Pulled from env or per-integration storage.
 */
export function verifyMetaSignature(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  appSecret: string,
): VerifyResult {
  if (!signatureHeader) return { ok: false, reason: 'missing X-Hub-Signature-256' }
  if (!appSecret) return { ok: false, reason: 'no app secret configured' }
  if (!signatureHeader.startsWith(PREFIX)) {
    return { ok: false, reason: 'signature header missing sha256= prefix' }
  }
  const providedHex = signatureHeader.slice(PREFIX.length).trim().toLowerCase()
  // SHA-256 hex is exactly 64 chars. Anything else can't be valid.
  if (providedHex.length !== 64 || !/^[0-9a-f]+$/.test(providedHex)) {
    return { ok: false, reason: 'malformed signature hex' }
  }

  const bodyBuf = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody
  const expectedHex = createHmac('sha256', appSecret).update(bodyBuf).digest('hex')

  // timingSafeEqual demands equal-length buffers. Both are 32-byte digests
  // when length checks above pass — but double-check before the call so
  // we can't crash on a length-mismatch DoS.
  const expectedBuf = Buffer.from(expectedHex, 'hex')
  const providedBuf = Buffer.from(providedHex, 'hex')
  if (expectedBuf.length !== providedBuf.length) {
    return { ok: false, reason: 'digest length mismatch' }
  }
  const equal = timingSafeEqual(expectedBuf, providedBuf)
  return equal ? { ok: true } : { ok: false, reason: 'signature mismatch' }
}
