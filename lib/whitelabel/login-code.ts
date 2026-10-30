/**
 * Pure helpers for the white-label team sign-in (app/sign-in): a 6-digit
 * code emailed to a workspace member, typed back on the branded page.
 *
 * Why a code and not OAuth: Google/GitHub need every redirect host
 * registered up front, which can't follow customers' domains — and we
 * never want staff typing Google credentials on a domain whose DNS a
 * customer controls. Why not a password: no reset flow to build, and an
 * emailed code proves the mailbox every time.
 *
 * Codes are stored as an HMAC (keyed on the auth secret, bound to the
 * workspace + email) so a DB read alone can't replay one, and they are
 * single use, short-lived and attempt-capped. No Prisma here — see
 * ./sign-in.ts for the DB side.
 */

import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

export const CODE_LENGTH = 6
export const CODE_TTL_MINUTES = 10
/** Wrong guesses allowed against one code before it is burned. */
export const MAX_CODE_ATTEMPTS = 5
/** Rate limits over RATE_WINDOW_MINUTES. */
export const RATE_WINDOW_MINUTES = 15
export const MAX_CODES_PER_EMAIL = 5
export const MAX_CODES_PER_IP = 20

export function generateLoginCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0')
}

/** Trimmed + lowercased, or null when it isn't a plausible address. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  if (v.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null
  return v
}

/** Digits only (people paste "123 456"); null unless exactly CODE_LENGTH digits. */
export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  const v = String(raw).replace(/\D/g, '')
  return v.length === CODE_LENGTH ? v : null
}

export function hashLoginCode(code: string, workspaceId: string, email: string, secret: string): string {
  return createHmac('sha256', secret).update(`${workspaceId}\n${email}\n${code}`).digest('hex')
}

export function codeMatches(code: string, workspaceId: string, email: string, secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashLoginCode(code, workspaceId, email, secret), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

export type CodeState = 'usable' | 'expired' | 'used' | 'locked'

/** Whether a stored code may still be checked against a guess. */
export function codeState(row: { expiresAt: Date; consumedAt: Date | null; attempts: number }, now = new Date()): CodeState {
  if (row.consumedAt) return 'used'
  if (row.attempts >= MAX_CODE_ATTEMPTS) return 'locked'
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'usable'
}

/**
 * `"Brand" <address>` using the platform sender's address (the mailbox we
 * can actually send from) under the customer's brand name.
 */
export function brandedFromAddress(brandName: string, platformFrom: string): string {
  const addr = platformFrom.match(/<([^>]+)>/)?.[1]?.trim() || platformFrom.trim()
  const name = brandName.replace(/["\\\r\n<>]/g, '').trim() || 'Sign in'
  return `"${name}" <${addr}>`
}

/** Only same-site dashboard paths may be used as the post-sign-in destination. */
export function safeCallbackPath(raw: unknown, workspaceId: string): string | null {
  if (typeof raw !== 'string') return null
  const base = `/dashboard/${workspaceId}`
  if (raw !== base && !raw.startsWith(`${base}/`) && !raw.startsWith(`${base}?`)) return null
  if (raw.startsWith('//') || raw.includes('\\') || /[\r\n]/.test(raw)) return null
  return raw
}
