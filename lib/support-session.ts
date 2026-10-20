/**
 * Support access — a super admin working inside a customer's workspace.
 *
 * Staff need to build and deploy on behalf of customers who can't do it
 * themselves, without becoming visible members of the customer's team.
 * So instead of a WorkspaceMember row, access rides a second signed
 * cookie scoped to exactly ONE workspace:
 *
 *   - Admin → Workspaces → [workspace] → "Open workspace" (admin role or
 *     higher, 2FA satisfied) mints `voxility_support`: an HS256 JWT
 *     {sub: adminId, wid: workspaceId, uid: supportUserId}, 2h TTL.
 *   - `auth()` in lib/auth.ts returns a support Session for the admin's
 *     own User row (matched by email, created on first use) whenever this
 *     cookie verifies. That Session carries `support.workspaceId`.
 *   - requireWorkspaceAccess / requireWorkspaceRole / findMemberRole
 *     grant the role SUPPORT_ROLE for that one workspace when there is no
 *     membership row. Every other workspace still requires membership,
 *     so the cookie can't be replayed against a different customer.
 *
 * The cookie alone is never enough: on every read we also require a live
 * admin session (voxility_admin) for the SAME admin, still active, still
 * admin+ and 2FA-verified. Revoking an admin, or their admin session
 * expiring, ends support access immediately.
 *
 * SUPPORT_ROLE is 'admin', not 'owner': enough to build agents, connect
 * channels and deploy, but owner-only actions (billing, deleting the
 * workspace, ownership transfer) stay with the customer. Billing routes
 * do their own membership lookups and deliberately don't honour support.
 *
 * Hidden from the customer by design (no member row → not in Team,
 * not in chat routing, not in digests). The paper trail is the admin
 * audit log: support_session_start / support_session_end.
 */

import { cache } from 'react'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import type { Session } from 'next-auth'
import { db } from './db'
import { adminTokenSecret, requireAdminRole, type AdminSession } from './admin-auth'

export const SUPPORT_COOKIE = 'voxility_support'
const SUPPORT_TTL_SECONDS = 60 * 60 * 2 // 2 hours
export const SUPPORT_ROLE = 'admin' as const

export interface SupportContext {
  adminId: string
  adminEmail: string
  workspaceId: string
}

// Session as returned by auth() while support is active.
export type SupportAwareSession = Session & { support?: SupportContext }

/**
 * The admin's own User row (matched by email), created on first use so
 * records written during support (createdBy etc.) point at a real user
 * that names the staff member rather than the customer.
 */
export async function getOrCreateSupportUser(admin: AdminSession): Promise<{ id: string }> {
  const email = admin.email.trim().toLowerCase()
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } })
  if (existing) return existing
  return db.user.create({
    data: { email, name: admin.name ?? email, onboardingCompletedAt: new Date() },
    select: { id: true },
  })
}

export async function startSupportSession(admin: AdminSession, workspaceId: string): Promise<void> {
  const user = await getOrCreateSupportUser(admin)
  const token = await new SignJWT({ wid: workspaceId, uid: user.id, purpose: 'support' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SUPPORT_TTL_SECONDS}s`)
    .setSubject(admin.adminId)
    .sign(adminTokenSecret())
  const jar = await cookies()
  jar.set(SUPPORT_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SUPPORT_TTL_SECONDS,
  })
}

export async function clearSupportCookie(): Promise<void> {
  const jar = await cookies()
  jar.delete(SUPPORT_COOKIE)
}

/** Raw cookie payload, verified for signature + expiry only. */
export async function readSupportCookie(): Promise<{ adminId: string; workspaceId: string; userId: string } | null> {
  let token: string | undefined
  try {
    token = (await cookies()).get(SUPPORT_COOKIE)?.value
  } catch {
    return null // outside a request scope
  }
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, adminTokenSecret(), { algorithms: ['HS256'] })
    if (payload.purpose !== 'support' || !payload.sub) return null
    if (typeof payload.wid !== 'string' || typeof payload.uid !== 'string') return null
    return { adminId: payload.sub, workspaceId: payload.wid, userId: payload.uid }
  } catch {
    return null
  }
}

/**
 * The support Session for this request, or null. Cached per request —
 * auth() is called many times while rendering one dashboard page.
 */
export const getSupportSession = cache(async (): Promise<SupportAwareSession | null> => {
  const claim = await readSupportCookie()
  if (!claim) return null
  const admin = await requireAdminRole('admin')
  if (!admin || admin.adminId !== claim.adminId) return null
  const user = await db.user.findUnique({
    where: { id: claim.userId },
    select: { id: true, name: true, email: true, image: true },
  })
  if (!user) return null
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      // Never show the onboarding modal to staff in a customer workspace.
      onboardingCompletedAt: new Date(0).toISOString(),
    },
    expires: new Date(Date.now() + SUPPORT_TTL_SECONDS * 1000).toISOString(),
    support: { adminId: admin.adminId, adminEmail: admin.email, workspaceId: claim.workspaceId },
  }
})

/** The support role for this workspace, if the session is a support session scoped to it. */
export function supportRoleFor(session: unknown, workspaceId: string): typeof SUPPORT_ROLE | null {
  const support = (session as SupportAwareSession | null)?.support
  return support && support.workspaceId === workspaceId ? SUPPORT_ROLE : null
}

/**
 * Drop-in for the hand-rolled `workspaceMember.findUnique({ userId_workspaceId })`
 * access checks: the caller's membership role, or the support role when
 * they're in a support session for this workspace.
 */
export async function findMemberRole(
  session: { user?: { id?: string | null } | null } | null,
  workspaceId: string,
): Promise<{ role: string } | null> {
  const userId = session?.user?.id
  if (!userId) return null
  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { role: true },
  })
  if (member) return member
  const support = supportRoleFor(session, workspaceId)
  return support ? { role: support } : null
}
