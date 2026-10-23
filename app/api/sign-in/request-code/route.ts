import { NextRequest, NextResponse } from 'next/server'
import { resolveTeamBrand } from '@/lib/domains/host-brand'
import { isCrossSiteRequest } from '@/lib/csrf'
import { normalizeEmail } from '@/lib/whitelabel/login-code'
import { requestLoginCode } from '@/lib/whitelabel/sign-in'

export const dynamic = 'force-dynamic'

/**
 * POST { email } — email a one-time sign-in code for the white-label
 * workspace that owns this host (see lib/whitelabel/sign-in.ts).
 *
 * Same answer whether or not the address belongs to the team, so the
 * page doesn't reveal who works there. Only rate limiting is distinct.
 */
export async function POST(req: NextRequest) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: 'Cross-site request refused' }, { status: 403 })
  }
  const brand = await resolveTeamBrand(req.headers.get('host'))
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const email = normalizeEmail(body?.email)
  if (!email) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
  try {
    const result = await requestLoginCode(brand, email, ip)
    if (result === 'rate_limited') {
      return NextResponse.json({ error: 'Too many codes requested. Wait a few minutes and try again.' }, { status: 429 })
    }
  } catch (err) {
    console.error('[sign-in] request-code failed', err)
    return NextResponse.json({ error: 'Could not send a code right now. Try again shortly.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
