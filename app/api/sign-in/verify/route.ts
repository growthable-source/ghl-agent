import { NextRequest, NextResponse } from 'next/server'
import { resolveTeamBrand } from '@/lib/domains/host-brand'
import { isCrossSiteRequest } from '@/lib/csrf'
import { REGULAR_SESSION_COOKIE } from '@/lib/embed-session'
import { normalizeCode, normalizeEmail, safeCallbackPath } from '@/lib/whitelabel/login-code'
import { mintTeamSession, SESSION_MAX_AGE, verifyLoginCode } from '@/lib/whitelabel/sign-in'

export const dynamic = 'force-dynamic'

const ERRORS = {
  invalid: 'That code is not right. Check the latest email, or request a new code.',
  expired: 'That code has expired. Request a new one.',
  no_access: 'This email is not on the team. Ask your administrator for an invite.',
} as const

/**
 * POST { email, code, callbackUrl? } — check a sign-in code and, on
 * success, set the session cookie for THIS host only (no Domain
 * attribute), so the session never travels to our own hosts or any other
 * customer's. Returns where to go next.
 */
export async function POST(req: NextRequest) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: 'Cross-site request refused' }, { status: 403 })
  }
  const brand = await resolveTeamBrand(req.headers.get('host'))
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const email = normalizeEmail(body?.email)
  const code = normalizeCode(body?.code)
  if (!email || !code) return NextResponse.json({ error: 'Enter the 6-digit code from the email.' }, { status: 400 })

  const result = await verifyLoginCode(brand.workspaceId, email, code)
  if (!result.ok) return NextResponse.json({ error: ERRORS[result.error] }, { status: result.error === 'no_access' ? 403 : 400 })

  const home = result.role === 'agent'
    ? `/dashboard/${brand.workspaceId}/inbox`
    : `/dashboard/${brand.workspaceId}`
  const sessionToken = await mintTeamSession(result.userId)
  const res = NextResponse.json({ ok: true, redirectTo: safeCallbackPath(body?.callbackUrl, brand.workspaceId) ?? home })
  res.cookies.set({
    name: REGULAR_SESSION_COOKIE,
    value: sessionToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
  return res
}
