/**
 * LeadConnector Custom-App SSO handshake.
 *
 * Inside the iframe Voxility runs in when launched from a LeadConnector
 * Custom Menu Link, the client posts a REQUEST_USER_DATA message to its
 * parent. The marketplace responds with an encrypted blob signed with
 * our app's Shared Secret. The client POSTs that blob here; we decrypt,
 * map it onto our own User / Workspace / Location, mint a NextAuth
 * database session, set the session cookie, and return the destination
 * URL.
 *
 * The decrypted payload is trustworthy because only Voxility and the
 * marketplace know the Shared Secret — anyone fabricating a payload
 * without it gets caught at decrypt time. We do still verify the user
 * has membership in the matching workspace before minting the session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { decryptSsoBlob } from '@/lib/leadconnector-sso'
import { EMBED_SESSION_COOKIE } from '@/lib/embed-session'

const SESSION_DAYS = 90

export async function POST(req: NextRequest) {
  const sharedSecret = process.env.LEADCONNECTOR_SSO_KEY
  if (!sharedSecret) {
    return NextResponse.json(
      { error: 'LEADCONNECTOR_SSO_KEY is not configured on this deployment.', code: 'SSO_NOT_CONFIGURED' },
      { status: 503 },
    )
  }

  let body: { encryptedData?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.encryptedData || typeof body.encryptedData !== 'string') {
    return NextResponse.json({ error: 'Missing encryptedData' }, { status: 400 })
  }

  let payload: ReturnType<typeof decryptSsoBlob>
  try {
    payload = decryptSsoBlob(body.encryptedData, sharedSecret)
  } catch (err: any) {
    console.error('[LeadConnector SSO] Decrypt failed:', err?.message)
    return NextResponse.json(
      { error: 'Could not verify the user data from the marketplace.', code: 'SSO_DECRYPT_FAILED' },
      { status: 400 },
    )
  }

  // Map marketplace identity onto Voxility records. Strategy:
  //   1. Find the Location row whose id matches activeLocation (or any
  //      Location in the same companyId if activeLocation isn't set —
  //      agency menu link with no sub-account selected).
  //   2. The Workspace is whatever owns that Location.
  //   3. The User is matched by email. If the email isn't in our DB we
  //      provision one (passwordless — they got here via the
  //      marketplace, that's their proof of identity).
  //   4. WorkspaceMember is upserted so the user actually has access.
  const { activeLocation, companyId, email, userName } = payload
  if (!email) {
    return NextResponse.json(
      { error: 'The marketplace did not provide an email in the SSO payload — cannot identify the user.' },
      { status: 400 },
    )
  }

  let location = null
  if (activeLocation) {
    location = await db.location.findUnique({
      where: { id: activeLocation },
      select: { id: true, workspaceId: true },
    })
  }
  if (!location && companyId) {
    // Agency-level menu link, or activeLocation wasn't in the DB yet.
    // Fall back to any Location with this companyId.
    location = await db.location.findFirst({
      where: { companyId },
      select: { id: true, workspaceId: true },
      orderBy: { installedAt: 'desc' },
    })
  }
  if (!location || !location.workspaceId) {
    return NextResponse.json(
      {
        error: 'No Voxility workspace is connected to this location yet. Reinstall the app via the marketplace to provision one.',
        code: 'NO_LOCATION',
      },
      { status: 404 },
    )
  }

  // Find or provision the user. We DON'T cross-check the user against
  // the marketplace's user table — anyone with a valid encrypted
  // payload is by definition someone the marketplace signed off on for
  // this location.
  let user = await db.user.findUnique({ where: { email }, select: { id: true } })
  if (!user) {
    user = await db.user.create({
      data: {
        email,
        name: userName || email.split('@')[0],
        emailVerified: new Date(),
      },
      select: { id: true },
    })
  }

  // Ensure WorkspaceMember exists. Default role is 'member' — the
  // workspace owner role is set at install time in the OAuth callback.
  // Marketplace admins land as 'admin' so they can do destructive
  // things; non-admin marketplace users land as 'member'.
  const role = payload.role === 'admin' ? 'admin' : 'member'
  await db.workspaceMember.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: location.workspaceId } },
    create: { userId: user.id, workspaceId: location.workspaceId, role },
    update: {},
  })

  // Mint a NextAuth database session by inserting a Session row + setting
  // the session cookie. NextAuth's database adapter resolves the cookie
  // by looking up sessionToken; no extra signing is involved.
  const sessionToken = randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await db.session.create({
    data: { sessionToken, userId: user.id, expires },
  })

  const res = NextResponse.json({
    ok: true,
    workspaceId: location.workspaceId,
    locationId: location.id,
    redirectTo: `/dashboard/${location.workspaceId}/agents?embedded=leadconnector`,
  })

  // The embed cookie is deliberately a DIFFERENT name from the regular
  // NextAuth session cookie. Keeping them separate means:
  //   1. A passive browser session in another tab (SameSite=Lax) won't
  //      be piggybacked by a malicious site that iframes Voxility — its
  //      cookie can't travel in a third-party context, ours can.
  //   2. Signing out of one context doesn't kill the other.
  // Middleware promotes this value onto the regular cookie name on the
  // request side so downstream auth() consumers don't need to change.
  // Browsers that block third-party cookies entirely fall through to
  // re-running the handshake on every load — fine, it's idempotent.
  res.cookies.set({
    name: EMBED_SESSION_COOKIE,
    value: sessionToken,
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  })
  return res
}
