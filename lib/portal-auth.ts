/**
 * Customer-Portal authentication.
 *
 * Deliberately separate from NextAuth (which authenticates workspace
 * operators with database-backed sessions + OAuth) and from SuperAdmin
 * auth (which authenticates *us* with bcrypt + 2FA). Reasons mirror
 * lib/admin-auth.ts:
 *
 *   1. The main app uses database-backed NextAuth sessions. Layering a
 *      Credentials provider on top would require switching to JWT
 *      sessions and would log every existing OAuth user out.
 *   2. Portal users are *customers of our customers* — different audience,
 *      read-only data, separate cookie + audience boundary keeps the blast
 *      radius of a portal-cookie leak contained.
 *   3. A portal user invited to brands A,B should not be able to escalate
 *      to anything else by reusing a session token. The PortalUser row
 *      keeps that gate independent of the rest of the user graph.
 *
 * Flow:
 *   - Admin invites a customer → PortalInvite row + email with token.
 *   - User opens /portal/invite/<token> → sets a password → row becomes
 *     PortalUser (passwordHash filled, acceptedAt set, brand assignments
 *     materialized atomically).
 *   - POST /api/portal/login: email+password → bcrypt check → set signed
 *     JWT cookie "voxility_portal".
 *   - Every /portal page calls getPortalSession() which reads + verifies
 *     the cookie and returns the user + their brand assignments, or null.
 */

import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { db } from './db'

const COOKIE_NAME = 'voxility_portal'
// Companion cookie with SameSite=None so the portal session travels when
// the portal is framed inside the LeadConnector menu (third-party iframe
// context — Lax cookies don't attach there). Mirrors the dashboard's
// dual-cookie pattern: the Lax cookie stays the primary for normal tabs;
// this one exists purely for iframes. Same JWT value, same TTL.
const EMBED_COOKIE_NAME = 'voxility_portal_embed'
// 14 days. Long enough that customers don't need to re-auth weekly,
// short enough that a stolen cookie expires before most invoice cycles.
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14

function secret(): Uint8Array {
  const raw = process.env.PORTAL_SESSION_SECRET
    ?? process.env.NEXTAUTH_SECRET
    ?? process.env.AUTH_SECRET
  if (!raw) {
    throw new Error('PORTAL_SESSION_SECRET / NEXTAUTH_SECRET / AUTH_SECRET must be set for portal auth')
  }
  return new TextEncoder().encode(raw)
}

export interface PortalSession {
  userId: string
  portalId: string
  email: string
  name: string | null
  // Brand IDs the user can see. Loaded fresh from the DB on every
  // getPortalSession() call so revoking a brand assignment takes effect
  // immediately — we never trust the JWT for authorization data.
  brandIds: string[]
}

// ─── Token helpers ──────────────────────────────────────────────────────────

export async function signPortalToken(user: { userId: string; portalId: string; email: string }): Promise<string> {
  return new SignJWT({
    portalId: user.portalId,
    email: user.email,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .setSubject(user.userId)
    .setAudience('portal')
    .sign(secret())
}

async function verifyPortalToken(token: string): Promise<{ userId: string; portalId: string; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ['HS256'], audience: 'portal' })
    if (!payload.sub || typeof payload.email !== 'string' || typeof payload.portalId !== 'string') return null
    return {
      userId: String(payload.sub),
      portalId: String(payload.portalId),
      email: String(payload.email),
    }
  } catch {
    return null
  }
}

// ─── Password helpers ──────────────────────────────────────────────────────

export async function hashPortalPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12)
}

export async function verifyPortalPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

// ─── Server-side helpers ───────────────────────────────────────────────────

/**
 * Reads + verifies the portal cookie, then re-fetches the PortalUser row
 * (and its brand assignments) so revoked users / revoked brand
 * assignments take effect immediately. Returns null if anything is off.
 */
export async function getPortalSession(): Promise<PortalSession | null> {
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value ?? jar.get(EMBED_COOKIE_NAME)?.value
  if (!token) return null
  const payload = await verifyPortalToken(token)
  if (!payload) return null
  const user = await db.portalUser.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      portalId: true,
      email: true,
      name: true,
      isActive: true,
      portal: { select: { isActive: true } },
      brandAssignments: { select: { brandId: true } },
    },
  })
  if (!user || !user.isActive || !user.portal.isActive) return null
  // Defence-in-depth — refuse a token that was minted for a different portal.
  if (user.portalId !== payload.portalId) return null
  return {
    userId: user.id,
    portalId: user.portalId,
    email: user.email,
    name: user.name,
    brandIds: user.brandAssignments.map(a => a.brandId),
  }
}

export async function setPortalCookie(token: string): Promise<void> {
  const jar = await cookies()
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  })
  // SameSite=None requires Secure, so the embed cookie only exists in
  // production (HTTPS). Locally the portal can't be iframe-tested anyway.
  if (process.env.NODE_ENV === 'production') {
    jar.set(EMBED_COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    })
  }
}

export async function clearPortalCookie(): Promise<void> {
  const jar = await cookies()
  jar.delete(COOKIE_NAME)
  jar.delete(EMBED_COOKIE_NAME)
}
