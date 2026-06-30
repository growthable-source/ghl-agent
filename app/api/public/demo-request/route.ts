/**
 * Public demo-request capture for paid landing pages (e.g. /gyms).
 *
 * Unauthenticated, CORS-open. Captures a qualified lead BEFORE the visitor
 * reaches the booking calendar, so a half-finished booking is still a lead
 * we own + can speed-to-lead follow up. The richer fields (name, phone,
 * company, qualifier) ride inside the existing MarketingLead.utm Json bag
 * so there's NO schema migration — the load-bearing follow-up data also
 * lands in the CRM when they actually book the calendar.
 *
 *   POST { email, name?, phone?, company?, monthlyLeads?, source?, utm? }
 *     -> { ok: true }
 *
 * Soft-fails (503, friendly message) if the MarketingLead table isn't
 * migrated yet — never 500s the form.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { handleMarketingLead } from '@/lib/marketing-lead-handler'

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
  return createHash('sha256').update(ip).digest('hex').slice(0, 32)
}

function str(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400, headers: CORS })
  }

  const source = str(body.source, 64) || 'demo'
  const utmParams =
    body.utm && typeof body.utm === 'object' && !Array.isArray(body.utm)
      ? (body.utm as Record<string, string>)
      : {}

  // Lead detail rides in the utm Json bag (no migration). Namespaced under
  // `lead` so utm attribution stays clean and the contact detail is grouped.
  const lead = {
    name: str(body.name, 120),
    phone: str(body.phone, 40),
    company: str(body.company, 160),
    monthlyLeads: str(body.monthlyLeads, 40),
  }
  const detailJson = { ...utmParams, lead }
  const referrer = req.headers.get('referer')?.slice(0, 500) ?? null

  try {
    const existing = await db.marketingLead.findUnique({ where: { email }, select: { id: true } }).catch(() => null)
    await db.marketingLead.upsert({
      where: { email },
      // Refresh the detail bag on repeat submit so the demo form's richer
      // fields win over an earlier bare-email newsletter signup.
      update: { utm: detailJson },
      create: { email, source, utm: detailJson, referrer, ipHash: clientIpHash(req) },
    })
    // Sync to the sales CRM + alert the team (only on first capture).
    await handleMarketingLead({
      email, name: lead.name, phone: lead.phone, company: lead.company,
      monthlyLeads: lead.monthlyLeads, source, referrer, alert: !existing,
    })
    return NextResponse.json({ ok: true }, { headers: CORS })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[demo-request] capture failed:', msg)
    return NextResponse.json(
      { error: "Thanks! We couldn't save that just now — please try again shortly." },
      { status: 503, headers: CORS },
    )
  }
}
