/**
 * Super-admin authentication.
 *
 * Deliberately separate from the main NextAuth pipeline. Reasons:
 *   1. The main app uses database-backed sessions (Prisma adapter). Adding
 *      Credentials to that pipeline requires switching to JWT sessions,
 *      which would log out every existing OAuth user in one deploy.
 *   2. Admin access should leave a clean audit trail of its own
 *      (AdminAuditLog) independent of regular user sessions.
 *   3. The admin cookie can carry a different expiry (short, 8h) without
 *      affecting regular users (30d).
 *
 * Flow:
 *   - POST /api/admin/login: email+password → bcrypt check against
 *     SuperAdmin.passwordHash → set signed-JWT cookie "voxility_admin".
 *   - Every admin page/route calls getAdminSession() which reads + verifies
 *     the cookie and returns the admin row, or null.
 *   - Cookie is HttpOnly, Secure, SameSite=Lax, 8h TTL.
 */

import { cookies, headers } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { db } from './db'

const COOKIE_NAME = 'voxility_admin'
const SESSION_TTL_SECONDS = 60 * 60 * 8   // 8 hours

// The secret is taken from env at call-time (not module-load) so tests and
// the CLI can set it after import. Falls back to NEXTAUTH_SECRET so we
// don't force a new env var for existing deployments.
function secret(): Uint8Array {
  const raw = process.env.ADMIN_SESSION_SECRET
    ?? process.env.NEXTAUTH_SECRET
    ?? process.env.AUTH_SECRET
  if (!raw) {
    throw new Error('ADMIN_SESSION_SECRET / NEXTAUTH_SECRET / AUTH_SECRET must be set for admin auth')
  }
  return new TextEncoder().encode(raw)
}

export interface AdminSession {
  adminId: string
  email: string
  name: string | null
}

// ─── Token helpers ──────────────────────────────────────────────────────────

export async function signAdminToken(admin: AdminSession): Promise<string> {
  return new SignJWT({ ...admin })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .setSubject(admin.adminId)
    .sign(secret())
}

async function verifyAdminToken(token: string): Promise<AdminSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'] })
    if (!payload.sub || typeof payload.email !== 'string') return null
    return {
      adminId: String(payload.sub),
      email: String(payload.email),
      name: typeof payload.name === 'string' ? payload.name : null,
    }
  } catch {
    return null
  }
}

// ─── Password helpers ──────────────────────────────────────────────────────

export async function hashPassword(plain: string): Promise<string> {
  // Cost 12 is sensible default — fast enough for a login endpoint,
  // slow enough to make brute force painful.
  return bcrypt.hash(plain, 12)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

// ─── Server-side helpers ───────────────────────────────────────────────────

/**
 * Reads and verifies the admin cookie. Also cross-checks the admin still
 * exists and is active in the DB so revoked admins can't ride a valid
 * JWT until natural expiry.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  if (!token) return null
  const payload = await verifyAdminToken(token)
  if (!payload) return null
  const admin = await db.superAdmin.findUnique({
    where: { id: payload.adminId },
    select: { id: true, email: true, name: true, isActive: true },
  })
  if (!admin || !admin.isActive) return null
  return { adminId: admin.id, email: admin.email, name: admin.name }
}

/**
 * Page-level guard. Call at the top of server components / route handlers.
 * Returns the session or throws a redirect via Next.js navigation. Pages
 * should check for null and redirect themselves.
 */
export async function requireAdminOrNull(): Promise<AdminSession | null> {
  return getAdminSession()
}

export async function setAdminCookie(token: string): Promise<void> {
  const jar = await cookies()
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
}

export async function clearAdminCookie(): Promise<void> {
  const jar = await cookies()
  jar.delete(COOKIE_NAME)
}

// ─── Audit logging ─────────────────────────────────────────────────────────

/**
 * Write an AdminAuditLog row. Best-effort — callers shouldn't block their
 * response on a failed audit write. Captures request IP + UA automatically
 * from the current Next.js request headers when available.
 */
export async function logAdminAction(params: {
  admin: AdminSession
  action: string
  target?: string | null
  meta?: Record<string, unknown> | null
}): Promise<void> {
  try {
    let ipAddress: string | null = null
    let userAgent: string | null = null
    try {
      const h = await headers()
      ipAddress = h.get('x-forwarded-for')?.split(',')[0]?.trim()
        ?? h.get('x-real-ip')
        ?? null
      userAgent = h.get('user-agent')
    } catch {
      // headers() isn't callable everywhere (e.g. edge runtimes, tests).
      // Proceed without — the audit row is still useful.
    }
    await db.adminAuditLog.create({
      data: {
        adminId: params.admin.adminId,
        adminEmail: params.admin.email,
        action: params.action,
        target: params.target ?? null,
        // Prisma wants InputJsonValue here, not `Record<string, unknown>`.
        // Cast explicitly — we control the caller and pass JSON-safe data.
        meta: (params.meta ?? undefined) as any,
        ipAddress,
        userAgent,
      },
    })
  } catch (err) {
    console.warn('[AdminAudit] write failed:', err)
  }
}
