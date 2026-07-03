import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'
import { sendPortalReport } from '@/lib/portal/report-email'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * POST /api/admin/portals/:id/send-report-test  { email }
 * Renders the portal's report (7-day window) and sends it to ONE address
 * — the iterate-until-it-looks-right loop for scheduled reports.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  let body: any = {}
  try { body = await req.json() } catch {}
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  }

  const portal = await db.portal.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!portal) return NextResponse.json({ error: 'Portal not found' }, { status: 404 })

  const result = await sendPortalReport(portal.id, {
    windowDays: 7,
    toOverride: [email],
    context: 'portal-report-test',
  })
  logAdminActionAfter({ admin: session, action: 'send_portal_report_test', target: portal.id, meta: { email } })

  if (result.sent === 0) {
    return NextResponse.json({ error: result.skipped ?? 'Send failed — check RESEND_API_KEY and server logs' }, { status: 502 })
  }
  return NextResponse.json({ sent: result.sent })
}
