import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Twilio inbound-webhook signature validation.
 *
 * Algorithm (Twilio "Validating Signatures From Twilio"):
 *   1. Take the full request URL exactly as Twilio called it.
 *   2. Append every POST param, sorted by key, as key+value with NO
 *      separators, directly onto the URL string.
 *   3. HMAC-SHA1 that string with your Auth Token, base64 the digest.
 *   4. Constant-time compare against the X-Twilio-Signature header.
 */
export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  let data = url
  for (const key of Object.keys(params).sort()) {
    data += key + params[key]
  }
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64')
}

export function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  header: string | null | undefined,
): boolean {
  if (!header) return false
  const expected = computeTwilioSignature(authToken, url, params)
  const a = Buffer.from(expected)
  const b = Buffer.from(header)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
