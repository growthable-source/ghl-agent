import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Verify a Slack request signature (https://api.slack.com/authentication/verifying-requests-from-slack).
 *
 * Slack signs `v0:{timestamp}:{rawBody}` with the app's signing secret
 * (HMAC-SHA256) and sends the result as `X-Slack-Signature`, plus the
 * timestamp as `X-Slack-Request-Timestamp`. We recompute and compare in
 * constant time, and reject timestamps outside a 5-minute window to blunt
 * replay attacks.
 *
 * `body` must be the EXACT raw request body — parse-then-restringify will
 * not match. Read it with `await req.text()` before `JSON.parse`.
 */
export function verifySlackSignature(args: {
  secret: string
  signature: string | null | undefined
  timestamp: string | null | undefined
  body: string
  nowSeconds?: number
}): boolean {
  const { secret, signature, timestamp, body } = args
  if (!secret || !signature || !timestamp) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > 5 * 60) return false // replay window

  const expected = 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
