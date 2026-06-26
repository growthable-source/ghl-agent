import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { renderCsatReportHtml, renderCsatReportSubject } from '@/lib/csat-report'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * POST /api/workspaces/:workspaceId/csat/email
 * Body: { to: string }
 * Query: same filter params as /csat (days, brandId, rating, handler)
 *
 * Renders the CSAT report HTML against the current filters and sends
 * it via Resend. The HTML mirrors what the print page shows — inline
 * styles so Gmail / Outlook / Apple Mail render it consistently.
 *
 * Permission gate: members.invite is intentionally NOT required —
 * any workspace member can email themselves or a teammate a report.
 * The to-address is not validated against the workspace member list
 * because operators routinely send reports to clients (their brand's
 * stakeholders), not just internal users.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = await req.json().catch(() => ({}))
  const to = typeof body.to === 'string' ? body.to.trim() : ''
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return NextResponse.json({ error: 'Valid `to` email is required.' }, { status: 400 })
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Email sending isn\'t configured (RESEND_API_KEY missing).' }, { status: 503 })
  }

  // Pull the same data the dashboard sees — re-call /csat with the
  // same query params so any future filter additions Just Work.
  const url = new URL(req.url)
  const upstream = new URL(`/api/workspaces/${workspaceId}/csat`, url)
  for (const [k, v] of url.searchParams.entries()) upstream.searchParams.set(k, v)
  const dataRes = await fetch(upstream.toString(), {
    headers: { cookie: req.headers.get('cookie') ?? '' },
    cache: 'no-store',
  })
  if (!dataRes.ok) {
    return NextResponse.json({ error: 'Failed to load CSAT data for the report.' }, { status: 502 })
  }
  const data = await dataRes.json()

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { name: true },
  })
  const workspaceName = workspace?.name || 'Workspace'

  const html = renderCsatReportHtml(data, { workspaceId, workspaceName })
  const subject = renderCsatReportSubject(data, workspaceName)
  const from = process.env.NOTIFICATION_FROM_EMAIL || 'Xovera <notifications@xovera.io>'

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  })

  if (!sendRes.ok) {
    const text = await sendRes.text().catch(() => '')
    return NextResponse.json(
      { error: `Email send failed: ${sendRes.status} ${text.slice(0, 200)}` },
      { status: 502 }
    )
  }

  return NextResponse.json({ ok: true, sentTo: to })
}
