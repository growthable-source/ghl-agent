import { NextRequest, NextResponse } from 'next/server'
import { checkPreviewToken } from '@/lib/whitelabel/preview'
import { PREVIEW_COOKIE, PREVIEW_TOKEN_DAYS } from '@/lib/whitelabel/preview-token'
import { normalizeEmail } from '@/lib/whitelabel/login-code'

export const dynamic = 'force-dynamic'

/**
 * White-label test link (lib/whitelabel/preview.ts) — non-production only.
 *
 *   GET ?t=<token>[&email=…]  turn test mode on for this browser and open
 *                             the branded team sign-in
 *   GET ?exit=1               turn it off again
 *
 * A bad, expired or production request just lands on the normal page, so
 * a stale link fails quietly instead of showing an error to a tester.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl
  if (url.searchParams.get('exit')) {
    const res = NextResponse.redirect(new URL('/login', url.origin))
    res.cookies.delete(PREVIEW_COOKIE)
    return res
  }

  const token = url.searchParams.get('t')
  if (!checkPreviewToken(token)) {
    return NextResponse.redirect(new URL('/login', url.origin))
  }
  const target = new URL('/sign-in', url.origin)
  const email = normalizeEmail(url.searchParams.get('email'))
  if (email) target.searchParams.set('email', email)
  const res = NextResponse.redirect(target)
  res.cookies.set({
    name: PREVIEW_COOKIE,
    value: token!,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: PREVIEW_TOKEN_DAYS * 86_400,
  })
  return res
}
