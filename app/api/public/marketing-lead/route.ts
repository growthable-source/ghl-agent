/**
 * Public homepage email capture (launch updates / newsletter).
 *
 * Unauthenticated, CORS-open — the marketing site posts here. Deliberately
 * standalone from the funnel-builder `form-submit` path: it writes only the
 * MarketingLead table, with no Workspace / NativeContact / conversion-pixel
 * coupling.
 *
 *   POST { email, source?, utm? } -> { ok: true }
 *
 * Resilient: if the MarketingLead table hasn't been created in prod yet
 * (it's a hand-run migration), we don't 500 — we log and report a soft
 * failure so the form can show a friendly message instead of crashing.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { db } from '@/lib/db'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

function clientIpHash(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for')
  const ip = (xff ? xff.split(',')[0].trim() : req.headers.get('x-real-ip')) || ''
  if (!ip) return null
  // One-way hash — we never need the raw IP, only coarse de-dup/abuse signal.
  return createHash('sha256').update(ip).digest('hex').slice(0, 32)
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string
    source?: string
    utm?: Record<string, string>
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400, headers: CORS })
  }

  const source = (typeof body.source === 'string' && body.source.trim().slice(0, 64)) || 'homepage'
  const utm =
    body.utm && typeof body.utm === 'object' && !Array.isArray(body.utm) ? body.utm : undefined
  const referrer = req.headers.get('referer')?.slice(0, 500) ?? null

  try {
    await db.marketingLead.upsert({
      where: { email },
      // Don't clobber the original source/utm on a repeat submit; just keep it.
      update: {},
      create: { email, source, utm: utm ?? undefined, referrer, ipHash: clientIpHash(req) },
    })
    return NextResponse.json({ ok: true }, { headers: CORS })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Table not migrated yet, or any transient DB issue → soft-fail.
    console.error('[marketing-lead] capture failed:', msg)
    return NextResponse.json(
      { error: "Thanks! We couldn't save that just now — please try again shortly." },
      { status: 503, headers: CORS },
    )
  }
}
