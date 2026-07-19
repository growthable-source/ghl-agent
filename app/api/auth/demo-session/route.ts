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

/** Trusted client IP — same extraction/trust order used across the public
 *  /try/[slug] purchase routes (see checkout-session/route.ts's
 *  clientIp): x-real-ip (Vercel-set) first, then the LAST
 *  x-forwarded-for hop (proxy-appended, not client-controlled). Used only
 *  for the failed-consume warn log below — this route has no rate cap of
 *  its own because the token itself is the defense (see FAILED_CONSUME_DELAY_MS). */
function clientIp(req: NextRequest): string {
  const real = req.headers.get('x-real-ip')?.trim()
  if (real) return real
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const parts = fwd.split(',')
    const last = parts[parts.length - 1].trim()
    if (last) return last
  }
  return 'unknown'
}

// The real brute-force defense here is entropy, not this delay:
// createMagicLinkToken (lib/demo-purchase/magic-link.ts) mints 32
// cryptographically random bytes (256 bits) — guessing a valid token by
// brute force is infeasible regardless of request rate. This flat delay
// is belt-and-braces: it caps the request rate an attacker (or a buggy
// client retry loop) can throw at token-consume attempts from a single
// connection, and the accompanying warn log gives Ryan a paper trail if
// someone tries anyway.
const FAILED_CONSUME_DELAY_MS = 400

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
    console.warn(`[demo-session] token consume failed (reason=${result.reason ?? 'unknown'}) from ip=${clientIp(req)}`)
    await new Promise(r => setTimeout(r, FAILED_CONSUME_DELAY_MS))
    // Redirect back to the same slug — the token is now gone (or was
    // already gone), so /welcome/[token]'s peek will render the
    // used/expired state rather than silently failing here.
    return NextResponse.redirect(`${base}/welcome/${encodeURIComponent(token)}`, { status: 303 })
  }

  const user = await db.user.findUnique({ where: { id: result.userId }, select: { id: true } })
  if (!user) {
    console.warn(`[demo-session] token consumed but userId ${result.userId} no longer exists, from ip=${clientIp(req)}`)
    await new Promise(r => setTimeout(r, FAILED_CONSUME_DELAY_MS))
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
