/**
 * Public pre-signup capture (from /start). Saves the lead BEFORE the Google
 * OAuth handoff — so a visitor who bounces on Google's screen is still a
 * lead we own — and stashes their CRM choice + business name in a signed
 * cookie the post-login onboarding reads to skip re-asking.
 *
 *   POST { name, email, company?, crm } -> { ok: true }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { SIGNUP_INTENT_COOKIE, SIGNUP_INTENT_TTL_SECS, signSignupIntent, type CrmChoice } from '@/lib/signup-intent'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

function ipHash(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for')
  const ip = (xff ? xff.split(',')[0].trim() : req.headers.get('x-real-ip')) || ''
  return ip ? createHash('sha256').update(ip).digest('hex').slice(0, 32) : null
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const crm = body.crm as CrmChoice
  const name = str(body.name, 120)
  const company = str(body.company, 160)

  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400, headers: CORS })
  }
  if (crm !== 'ghl' && crm !== 'hubspot' && crm !== 'native') {
    return NextResponse.json({ error: 'Pick the CRM you use.' }, { status: 400, headers: CORS })
  }

  // Persist the lead (best-effort — never block signup if the table lags).
  try {
    const detail = { lead: { name, company }, signupCrmChoice: crm, intent: 'signup' }
    await db.marketingLead.upsert({
      where: { email },
      update: { utm: detail, source: 'signup' },
      create: { email, source: 'signup', utm: detail, referrer: req.headers.get('referer')?.slice(0, 500) ?? null, ipHash: ipHash(req) },
    })
  } catch (err) {
    console.error('[signup-intent] lead save failed (non-fatal):', err instanceof Error ? err.message : err)
  }

  const res = NextResponse.json({ ok: true }, { headers: CORS })
  res.cookies.set(SIGNUP_INTENT_COOKIE, signSignupIntent({ crm, email, name, company }), {
    httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: SIGNUP_INTENT_TTL_SECS,
  })
  return res
}
