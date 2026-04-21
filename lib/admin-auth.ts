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

export type AdminRole = 'viewer' | 'admin' | 'super'

export interface AdminSession {
  adminId: string
  email: string
  name: string | null
  role: AdminRole
  // True once TOTP has been verified on the current browser session.
  // When an admin has 2FA enrolled, the first login phase issues a token
  // with twoFactorVerified=false and a restricted cookie; full admin
  // access only unlocks after a successful /api/admin/2fa/login.
  twoFactorVerified: boolean
}

export function roleHas(role: AdminRole, required: AdminRole): boolean {
  // super > admin > viewer
  const rank: Record<AdminRole, number> = { viewer: 1, admin: 2, super: 3 }
  return rank[role] >= rank[required]
}

// ─── Token helpers ──────────────────────────────────────────────────────────

export async function signAdminToken(admin: AdminSession): Promise<string> {
  return new SignJWT({
    email: admin.email,
    name: admin.name,
    role: admin.role,
    twoFactorVerified: admin.twoFactorVerified,
  })
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
    const rawRole = typeof payload.role === 'string' ? payload.role : 'admin'
    const role: AdminRole = (rawRole === 'viewer' || rawRole === 'admin' || rawRole === 'super')
      ? rawRole as AdminRole
      : 'admin'
    return {
      adminId: String(payload.sub),
      email: String(payload.email),
      name: typeof payload.name === 'string' ? payload.name : null,
      role,
      twoFactorVerified: !!payload.twoFactorVerified,
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
 * exists, is active, and has the latest role in the DB so revoked admins
 * can't ride a valid JWT until natural expiry.
 *
 * Note: this returns the session even when 2FA hasn't been verified yet —
 * downstream callers (layout, gates) check `twoFactorVerified` themselves
 * and bounce to /admin/login/2fa when needed. This keeps the 2FA dance
 * out of the cookie parsing layer.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  if (!token) return null
  const payload = await verifyAdminToken(token)
  if (!payload) return null
  const admin = await db.superAdmin.findUnique({
    where: { id: payload.adminId },
    select: { id: true, email: true, name: true, isActive: true, role: true, twoFactorVerifiedAt: true },
  })
  if (!admin || !admin.isActive) return null
  const dbRole: AdminRole = (admin.role === 'viewer' || admin.role === 'admin' || admin.role === 'super')
    ? admin.role as AdminRole
    : 'admin'
  // If the admin has 2FA enrolled but the cookie says unverified, keep
  // that flag. If the admin has no 2FA enrolled, we always treat them
  // as verified (there's nothing else to check).
  const has2fa = !!admin.twoFactorVerifiedAt
  return {
    adminId: admin.id,
    email: admin.email,
    name: admin.name,
    role: dbRole,
    twoFactorVerified: has2fa ? payload.twoFactorVerified : true,
  }
}

/**
 * Page-level guard. Call at the top of server components / route handlers.
 * Returns the session only if the admin is fully authenticated AND 2FA
 * is satisfied. Anything else → null (caller decides what to redirect to).
 */
export async function requireAdminOrNull(): Promise<AdminSession | null> {
  const s = await getAdminSession()
  if (!s) return null
  if (!s.twoFactorVerified) return null
  return s
}

/**
 * Role gate. Returns null if the current session doesn't satisfy the
 * required role. Use in server components / route handlers that should
 * be hidden from viewer-tier admins.
 */
export async function requireAdminRole(required: AdminRole): Promise<AdminSession | null> {
  const s = await requireAdminOrNull()
  if (!s) return null
  if (!roleHas(s.role, required)) return null
  return s
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
