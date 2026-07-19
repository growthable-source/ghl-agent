/**
 * POST /api/auth/demo-session — consumes a /welcome/[token] magic link
 * and signs the buyer in.
 *
 * Submitted by a plain `<form method="POST">` on app/welcome/[token]/page.tsx
 * (no client JS required — works with JS disabled, and a mail-scanner can
 * only ever GET the /welcome/[token] page, never trigger this POST).
 *
 * Mirrors the session-minting mechanics of
 * app/api/auth/leadconnector-iframe-handshake/route.ts: insert a `Session`
 * row directly (NextAuth's database-adapter strategy resolves sessions by
 * sessionToken lookup, no signing involved) and set the cookie with the
 * EXACT name/options lib/auth.ts configures for NextAuth's own cookie —
 * anything else and downstream `auth()` calls won't see this session.
 *
 * `consumeMagicLinkToken` is the single-use CAS: a second click (or a
 * concurrent race) gets `ok: false` and is redirected back to
 * /welcome/[token], which re-peeks the (now-deleted) token and renders
 * the "already used" state instead of erroring.
 */
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { consumeMagicLinkToken } from '@/lib/demo-purchase/magic-link'
import { REGULAR_SESSION_COOKIE } from '@/lib/embed-session'

const SESSION_DAYS = 90 // must match lib/auth.ts session.maxAge / cookie maxAge

function appBase(req: NextRequest): string {
  return (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin).replace(/\/$/, '')
}

async function readToken(req: NextRequest): Promise<string> {
  const contentType = req.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const body = await req.json().catch(() => null as { token?: unknown } | null)
    return typeof body?.token === 'string' ? body.token : ''
  }
  const form = await req.formData().catch(() => null)
  const value = form?.get('token')
  return typeof value === 'string' ? value : ''
}

export async function POST(req: NextRequest) {
  const base = appBase(req)
  const token = await readToken(req)

  if (!token) {
    return NextResponse.redirect(`${base}/welcome/invalid`, { status: 303 })
  }

  const result = await consumeMagicLinkToken(token)
  if (!result.ok || !result.userId || !result.workspaceId) {
    // Redirect back to the same slug — the token is now gone (or was
    // already gone), so /welcome/[token]'s peek will render the
    // used/expired state rather than silently failing here.
    return NextResponse.redirect(`${base}/welcome/${encodeURIComponent(token)}`, { status: 303 })
  }

  const user = await db.user.findUnique({ where: { id: result.userId }, select: { id: true } })
  if (!user) {
    return NextResponse.redirect(`${base}/welcome/${encodeURIComponent(token)}`, { status: 303 })
  }

  const sessionToken = randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await db.session.create({ data: { sessionToken, userId: user.id, expires } })

  const res = NextResponse.redirect(`${base}/dashboard/${result.workspaceId}?fromDemo=purchase`, { status: 303 })

  // Byte-identical to lib/auth.ts's cookies.sessionToken config — same
  // name (via the shared REGULAR_SESSION_COOKIE constant), same options,
  // same 90-day maxAge in both dev and prod.
  res.cookies.set({
    name: REGULAR_SESSION_COOKIE,
    value: sessionToken,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  })

  return res
}
