/**
 * Partner builder SSO handshake.
 *
 * The partner's admin UI iframes /embedded/widget-builder?t=<token>.
 * That page posts the token here; we redeem it (single-use, 10-minute
 * TTL) and mint a real embed session so the builder loads authenticated.
 *
 * Why not reuse the LeadConnector handshake: that one authenticates by
 * successfully decrypting an AES-CBC blob whose key is derived with
 * iterated MD5, and carries no timestamp, nonce or replay protection.
 * It exists because the CRM defines the format. Here we define it, so
 * this uses a hashed-at-rest, single-use, short-TTL token instead.
 *
 * The session cookie is SameSite=None because it has to travel inside
 * the partner's frame. That's the same trade the CRM embed makes, but
 * narrower: CSP frame-ancestors for /embedded/widget-builder is pinned
 * to PARTNER_FRAME_ANCESTORS rather than '*', because unlike the
 * thousands of unknowable whitelabel CRM domains, we know exactly which
 * origins the partner serves its admin UI from.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { consumeBuilderToken } from '@/lib/partner/builder-token'
import { EMBED_SESSION_COOKIE, EMBED_WORKSPACE_COOKIE } from '@/lib/embed-session'

const SESSION_DAYS = 90

export async function POST(req: NextRequest) {
  let body: { token?: string } = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body', code: 'BAD_BODY' }, { status: 400 })
  }
  const token = (body.token || '').trim()
  if (!token) {
    return NextResponse.json({ error: 'Missing token', code: 'NO_TOKEN' }, { status: 400 })
  }

  const result = await consumeBuilderToken(token)
  if (!result.ok) {
    // Deliberately vague to the client, and identical timing for both
    // cases — the iframe has no use for the distinction, and neither
    // should anyone probing the endpoint.
    return NextResponse.json({
      error: result.reason === 'expired'
        ? 'This builder link has expired. Reopen it from your help centre admin.'
        : 'This builder link is no longer valid. Reopen it from your help centre admin.',
      code: result.reason === 'expired' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
    }, { status: 401 })
  }

  const { userId, workspaceId, widgetId } = result

  // The token proves who minted it, but the underlying rows can have
  // changed since — a deleted widget or a revoked membership must not
  // still let someone in.
  const [member, widget] = await Promise.all([
    db.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: userId!, workspaceId: workspaceId! } },
      select: { role: true },
    }),
    db.chatWidget.findUnique({ where: { id: widgetId! }, select: { id: true, workspaceId: true } }),
  ])
  if (!member) {
    return NextResponse.json({
      error: 'That account no longer has access to this workspace.',
      code: 'NO_ACCESS',
    }, { status: 403 })
  }
  if (!widget || widget.workspaceId !== workspaceId) {
    return NextResponse.json({
      error: 'That widget no longer exists.',
      code: 'WIDGET_NOT_FOUND',
    }, { status: 404 })
  }

  // Mint a NextAuth database session — the adapter resolves the cookie
  // by sessionToken lookup, so no extra signing is involved.
  const sessionToken = randomBytes(32).toString('hex')
  await db.session.create({
    data: {
      sessionToken,
      userId: userId!,
      expires: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
    },
  })

  const res = NextResponse.json({
    ok: true,
    workspaceId,
    widgetId,
    redirectTo: `/embedded/widget-builder/${widgetId}`,
  })

  const cookie = {
    httpOnly: true,
    secure: true,
    sameSite: 'none' as const,
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  }
  // Separate from the regular NextAuth cookie so a passive browser
  // session (SameSite=Lax) can't be piggybacked by a hostile frame, and
  // so signing out of one context doesn't kill the other. Middleware
  // promotes this onto the regular name request-side, so every
  // downstream auth() works unchanged.
  res.cookies.set({ name: EMBED_SESSION_COOKIE, value: sessionToken, ...cookie })
  res.cookies.set({ name: EMBED_WORKSPACE_COOKIE, value: workspaceId!, ...cookie })
  return res
}
