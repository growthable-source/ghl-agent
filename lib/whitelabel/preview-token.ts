/**
 * Pure helpers for white-label TEST MODE (see ./preview.ts).
 *
 * Testing the team sign-in for real needs a customer domain pointed at
 * the build, which non-technical testers can't set up. On non-production
 * builds a super admin can instead hand out a test link carrying this
 * token; opening it makes that browser treat our own host as the
 * workspace's white-label domain.
 *
 * Token: "<workspaceId>.<expiresAtSeconds>.<hmac>" — HMAC-SHA256 over the
 * first two parts, keyed on the auth secret, so it can't be forged or
 * re-pointed at another workspace. Node crypto only (never used in Edge).
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export const PREVIEW_COOKIE = 'wl_preview'
export const PREVIEW_TOKEN_DAYS = 30

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`wl-preview\n${payload}`).digest('hex')
}

export function mintPreviewToken(workspaceId: string, secret: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + PREVIEW_TOKEN_DAYS * 86_400
  const payload = `${workspaceId}.${exp}`
  return `${payload}.${sign(payload, secret)}`
}

/** The workspace id the token is for, or null when malformed, forged or expired. */
export function verifyPreviewToken(token: string | null | undefined, secret: string | null | undefined, now = Date.now()): string | null {
  if (!token || !secret) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [workspaceId, expRaw, sig] = parts
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(workspaceId) || !/^\d{1,12}$/.test(expRaw) || !/^[0-9a-f]{64}$/.test(sig)) return null
  const expected = Buffer.from(sign(`${workspaceId}.${expRaw}`, secret), 'hex')
  if (!timingSafeEqual(expected, Buffer.from(sig, 'hex'))) return null
  if (Number(expRaw) * 1000 <= now) return null
  return workspaceId
}

/**
 * Test mode exists only off production: Vercel preview deployments and
 * local dev. VERCEL_ENV is set on every Vercel deployment ('production' |
 * 'preview' | 'development'); without it we fall back to NODE_ENV.
 */
export function previewModeAllowed(env: { VERCEL_ENV?: string; NODE_ENV?: string }): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV !== 'production'
  return env.NODE_ENV !== 'production'
}
