/**
 * LeadConnector Custom-App SSO handshake.
 *
 * Inside the iframe Xovera runs in when launched from a LeadConnector
 * Custom Menu Link, the client posts a REQUEST_USER_DATA message to its
 * parent. The marketplace responds with an encrypted blob signed with
 * our app's Shared Secret. The client POSTs that blob here; we decrypt,
 * map it onto our own User / Workspace / Location, mint a NextAuth
 * database session, set the session cookie, and return the destination
 * URL.
 *
 * The decrypted payload is trustworthy because only Xovera and the
 * marketplace know the Shared Secret — anyone fabricating a payload
 * without it gets caught at decrypt time. We do still verify the user
 * has membership in the matching workspace before minting the session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { decryptSsoBlobAnyKey, ssoSharedSecrets } from '@/lib/leadconnector-sso'
import { EMBED_SESSION_COOKIE, EMBED_WORKSPACE_COOKIE } from '@/lib/embed-session'

const SESSION_DAYS = 90

export async function POST(req: NextRequest) {
  // Multiple marketplace apps (dashboard app, portal-wrapper app) share
  // this deployment, each with its own Shared Secret — accept any.
  if (ssoSharedSecrets().length === 0) {
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

  let payload: ReturnType<typeof decryptSsoBlobAnyKey>
  try {
    payload = decryptSsoBlobAnyKey(body.encryptedData)
  } catch (err) {
    console.error('[LeadConnector SSO] Decrypt failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: 'Could not verify the user data from the marketplace.', code: 'SSO_DECRYPT_FAILED' },
      { status: 400 },
    )
  }

  // Map marketplace identity onto Xovera records. Strategy:
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
        error: 'No Xovera workspace is connected to this location yet. Reinstall the app via the marketplace to provision one.',
        code: 'NO_LOCATION',
      },
      { status: 404 },
    )
  }

  // Find or provision the user. We DON'T cross-check the user against
  // the marketplace's user table — anyone with a valid encrypted
  // payload is by definition someone the marketplace signed off on for
  // this location.
  //
  // upsert (not findUnique-then-create) for two reasons:
  //   1. Avoids a TOCTOU race where two concurrent iframe loads each
  //      see "no user yet" and both try to create, exploding on the
  //      email unique constraint.
  //   2. Lets us write emailVerified=now on BOTH branches. The big
  //      gotcha that locked Ryan out of the app: existing Users that
  //      pre-date NextAuth's emailVerified handling carried a NULL
  //      value in that column, which then blocked
  //      `allowDangerousEmailAccountLinking` from auto-linking a fresh
  //      Google account on signin. Marketplace SSO is a strong
  //      identity signal (the encrypted payload only decrypts with our
  //      Shared Secret), so writing emailVerified=now here is correct
  //      and repairs any historical NULLs the next time a user passes
  //      through the iframe.
  const user = await db.user.upsert({
    where: { email },
    create: {
      email,
      name: userName || email.split('@')[0],
      emailVerified: new Date(),
    },
    update: {
      // Idempotent — bumping emailVerified to "most recently verified"
      // doesn't break anything (NextAuth only cares whether it's
      // non-null), and it self-heals legacy rows with NULL.
      emailVerified: new Date(),
      // Refresh the displayed name from SSO when GHL returns one, but
      // don't blank it out if they don't (preserve whatever's in the
      // DB for users who set a name manually).
      ...(userName ? { name: userName } : {}),
    },
    select: { id: true },
  })

  // Ensure WorkspaceMember exists. Default role is 'member' — the
  // workspace owner role is set at install time in the OAuth callback.
  // Marketplace admins land as 'admin' so they can do destructive
  // things; non-admin marketplace users land as 'member'.
  const role = payload.role === 'admin' ? 'admin' : 'member'
  // Refresh the role on every handshake — marketplace payload is the
  // source of truth. The old `update: {}` meant a user demoted in
  // GHL kept their elevated Xovera access forever (and vice versa,
  // a promotion never propagated). We do NOT touch 'owner' rows
  // though — that role is set by direct-signup workspace creation
  // and shouldn't be clobbered just because the same user also has
  // a GHL marketplace install routing through SSO.
  const existingMember = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: location.workspaceId } },
    select: { role: true },
  })
  if (!existingMember) {
    await db.workspaceMember.create({
      data: { userId: user.id, workspaceId: location.workspaceId, role },
    })
  } else if (existingMember.role !== 'owner' && existingMember.role !== role) {
    await db.workspaceMember.update({
      where: { userId_workspaceId: { userId: user.id, workspaceId: location.workspaceId } },
      data: { role },
    })
  }

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
  //      be piggybacked by a malicious site that iframes Xovera — its
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

  // Bind this iframe session to its specific workspace. The /dashboard
  // root redirect reads this cookie when a user navigates back to the
  // picker inside the iframe — without it, a user with multiple
  // marketplace installs (one per GHL sub-account) gets sent to
  // whichever marketplace workspace appears first in their list,
  // not the one they're actually viewing from. Re-written on every
  // handshake, so switching sub-accounts in GHL updates the binding.
  res.cookies.set({
    name: EMBED_WORKSPACE_COOKIE,
    value: location.workspaceId,
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  })
  return res
}
