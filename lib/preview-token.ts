/**
 * Short-lived HMAC tokens that let Browserbase render an unpublished
 * landing page during the build loop without exposing it publicly.
 *
 * The /p/<slug> renderer hides unpublished pages with a 404. The build
 * orchestrator needs to render those pages mid-iteration, so it signs
 * a token (page id + expiry, HMAC-SHA256 with VOXILITY_PREVIEW_SECRET)
 * and appends ?preview=<token>. The renderer verifies and bypasses
 * the published gate.
 *
 * Tokens are bound to a specific page id — they don't grant access to
 * other pages — and to a short expiry (default 10 minutes, just longer
 * than the longest expected build). Constant-time comparison.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

const DEFAULT_TTL_MS = 10 * 60 * 1000

interface SignedToken {
  pageId: string
  expiresAt: number
}

function getSecret(): Buffer {
  const s = process.env.VOXILITY_PREVIEW_SECRET
  if (!s) {
    throw new Error('VOXILITY_PREVIEW_SECRET is not set — preview tokens cannot be signed/verified.')
  }
  return Buffer.from(s, 'utf8')
}

export function signPreviewToken(pageId: string, ttlMs: number = DEFAULT_TTL_MS): string {
  const expiresAt = Date.now() + Math.max(60_000, ttlMs)
  const payload = `${pageId}.${expiresAt}`
  const sig = createHmac('sha256', getSecret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyPreviewToken(token: string, pageId: string): boolean {
  const parsed = parse(token)
  if (!parsed) return false
  if (parsed.pageId !== pageId) return false
  if (parsed.expiresAt < Date.now()) return false
  const expectedSig = createHmac('sha256', getSecret())
    .update(`${parsed.pageId}.${parsed.expiresAt}`)
    .digest('base64url')
  const presentedSig = parsed.signature
  if (expectedSig.length !== presentedSig.length) return false
  return timingSafeEqual(Buffer.from(expectedSig), Buffer.from(presentedSig))
}

function parse(token: string): (SignedToken & { signature: string }) | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [pageId, expiresStr, signature] = parts
  if (!pageId || !expiresStr || !signature) return null
  const expiresAt = Number.parseInt(expiresStr, 10)
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return null
  return { pageId, expiresAt, signature }
}
