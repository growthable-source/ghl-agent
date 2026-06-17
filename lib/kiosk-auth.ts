/**
 * Shared-login kiosk auth.
 *
 * Two PIN tiers, deliberately separate:
 *
 *   1. Shared workspace PIN  → unlocks the operator name-grid on
 *      /kiosk/<slug>. Issues a short-lived signed "launcher" cookie that
 *      grants NO app access on its own — it only proves "the shared door
 *      was opened" so the picker can list operators.
 *   2. Per-operator PIN      → mints a normal NextAuth database session as
 *      that operator's real User. From there the app behaves exactly as a
 *      regular sign-in: presence, round-robin routing, and message
 *      attribution all key on the real User.id with zero special-casing.
 *
 * PINs are low-entropy by design (entered on a shared terminal), so they
 * are bcrypt-hashed AND rate-limited with a lockout window. The launcher
 * token is a signed JWT (jose) mirroring lib/portal-auth.ts — we never
 * trust it for authorization, only to gate the picker UI.
 */

import { randomBytes } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { db } from './db'

// Launcher cookie — signed proof the shared workspace PIN was entered.
// httpOnly + Lax: the kiosk is a normal browser tab, not an iframe.
export const KIOSK_LAUNCHER_COOKIE = 'voxility-kiosk-launcher'
// 30 minutes — long enough to pick + re-pick across a shift change, short
// enough that an unattended terminal re-prompts for the shared PIN.
const LAUNCHER_TTL_SECONDS = 60 * 30

const SESSION_DAYS = 90

// Lockout: after this many bad PINs, refuse further attempts for the window.
export const MAX_PIN_ATTEMPTS = 5
export const LOCKOUT_MINUTES = 5

function secret(): Uint8Array {
  const raw =
    process.env.NEXTAUTH_SECRET ??
    process.env.AUTH_SECRET
  if (!raw) {
    throw new Error('NEXTAUTH_SECRET / AUTH_SECRET must be set for kiosk auth')
  }
  return new TextEncoder().encode(raw)
}

// ─── Launcher token (jose) ───────────────────────────────────────────────────

export async function signKioskLauncher(workspaceId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${LAUNCHER_TTL_SECONDS}s`)
    .setSubject(workspaceId)
    .setAudience('kiosk')
    .sign(secret())
}

/** Returns the workspaceId the launcher was minted for, or null. */
export async function verifyKioskLauncher(token: string | undefined): Promise<string | null> {
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ['HS256'],
      audience: 'kiosk',
    })
    return payload.sub ? String(payload.sub) : null
  } catch {
    return null
  }
}

export const LAUNCHER_COOKIE_MAX_AGE = LAUNCHER_TTL_SECONDS

// ─── PIN helpers ─────────────────────────────────────────────────────────────

/** Generate a numeric PIN of the given length (default 6). */
export function generatePin(digits = 6): string {
  let out = ''
  // Reject-free: take bytes, map each to a digit. randomBytes is plenty.
  const buf = randomBytes(digits)
  for (let i = 0; i < digits; i++) out += String(buf[i] % 10)
  return out
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 12)
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash)
}

export function lastFourOf(pin: string): string {
  return pin.slice(-4)
}

// ─── Lockout helper ──────────────────────────────────────────────────────────

/**
 * Pure lockout state-machine over an attempt counter. Given the current
 * counter + lock and whether the latest attempt succeeded, returns the
 * next persisted state and whether the caller is currently locked out.
 * Caller persists `next` on the KioskCredential / KioskOperator row.
 */
export function nextLockState(
  current: { failedAttempts: number; lockedUntil: Date | null },
  now: Date,
  success: boolean,
): { locked: boolean; next: { failedAttempts: number; lockedUntil: Date | null } } {
  // Currently locked and window not elapsed → hard stop, don't even check.
  if (current.lockedUntil && current.lockedUntil > now) {
    return { locked: true, next: current }
  }
  if (success) {
    return { locked: false, next: { failedAttempts: 0, lockedUntil: null } }
  }
  const failedAttempts = current.failedAttempts + 1
  if (failedAttempts >= MAX_PIN_ATTEMPTS) {
    return {
      locked: false, // this attempt is processed (and failed); next ones are locked
      next: {
        failedAttempts: 0,
        lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000),
      },
    }
  }
  return { locked: false, next: { failedAttempts, lockedUntil: null } }
}

// ─── Session minting ─────────────────────────────────────────────────────────

/**
 * Mint a NextAuth database session for `userId` by inserting a Session row
 * and returning the opaque session token. The caller sets it as the
 * regular session cookie. Mirrors the iframe-handshake minting at
 * app/api/auth/leadconnector-iframe-handshake/route.ts.
 */
export async function mintOperatorSession(userId: string): Promise<string> {
  const sessionToken = randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await db.session.create({ data: { sessionToken, userId, expires } })
  return sessionToken
}

// ─── Synthetic operator email ────────────────────────────────────────────────

/**
 * Build a non-deliverable, unique email for a kiosk operator's synthetic
 * User. The `.invalid` TLD is reserved (RFC 2606) so it can never collide
 * with a real mailbox or be mistaken for one.
 */
export function syntheticOperatorEmail(slug: string): string {
  return `kiosk_${randomBytes(6).toString('hex')}@${slug}.kiosk.invalid`
}
