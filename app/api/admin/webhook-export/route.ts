import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdminSession, logAdminActionAfter } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'
// POST timeout is 20s; the upstream fetch + DB collect dominate. 60s
// leaves room for the audit log write that runs via after().
export const maxDuration = 60

// One-shot webhook fire from the admin UI. Collects the filtered set into
// one JSON body and POSTs it. No retries — admin can re-click if the
// receiver was down. Capped so a runaway click can't DoS someone's endpoint.
const MAX_ROWS = 10_000
const POST_TIMEOUT_MS = 20_000

export async function POST(req: NextRequest) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Accept both JSON and form-post so the inline <form> on the list pages
  // can submit without JS.
  let body: Record<string, string> = {}
  const contentType = req.headers.get('content-type') ?? ''
  try {
    if (contentType.includes('application/json')) {
      body = (await req.json()) as Record<string, string>
    } else {
      const fd = await req.formData()
      body = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)]))
    }
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const url = String(body.url ?? '').trim()
  const entity = String(body.entity ?? '').trim()
  if (!url || !/^https?:\/\//.test(url)) {
    return NextResponse.json({ error: 'Valid https URL required' }, { status: 400 })
  }
  if (!['users', 'workspaces', 'logs'].includes(entity)) {
    return NextResponse.json({ error: 'Unknown entity' }, { status: 400 })
  }

  // Q-prefixed form fields carry the current filter state (q_q=ryan).
  // Unprefix them so the payload looks consistent with the admin UI.
  const filters: Record<string, string> = {}
  for (const [k, v] of Object.entries(body)) {
    if (k.startsWith('q_') && v) filters[k.slice(2)] = v
  }

  // Assemble the payload — same shape as the CSV exports for consistency.
  let rowCount = 0
  let payload: { entity: string; filters: Record<string, string>; rows: any[]; generatedAt: string }
  try {
    const rows = await collect(entity, filters)
    rowCount = rows.length
    payload = {
      entity,
      filters,
      rows,
      generatedAt: new Date().toISOString(),
    }
  } catch (err: any) {
    logAdminActionAfter({
      admin: session,
      action: 'webhook_export_error',
      target: url,
      meta: { entity, filters, error: err.message },
    })
    return NextResponse.json({ error: `Failed to build payload: ${err.message}` }, { status: 500 })
  }

  // Fire with a hard timeout. We do NOT retry — admins can re-click.
  const controller = new AbortController()
  const to = setTimeout(() => controller.abort(), POST_TIMEOUT_MS)
  let responseStatus = 0
  let responseBody = ''
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Voxility-Admin-Export': `${entity}; rows=${rowCount}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    responseStatus = res.status
    responseBody = (await res.text()).slice(0, 500)
  } catch (err: any) {
    clearTimeout(to)
    logAdminActionAfter({
      admin: session,
      action: 'webhook_export_failed',
      target: url,
      meta: { entity, rowCount, error: err.message },
    })
    return NextResponse.json({
      ok: false,
      error: `Webhook POST failed: ${err.message}`,
      rowCount,
    }, { status: 502 })
  } finally {
    clearTimeout(to)
  }

  logAdminActionAfter({
    admin: session,
    action: 'webhook_export',
    target: url,
    meta: { entity, filters, rowCount, responseStatus },
  })

  return NextResponse.json({
    ok: responseStatus >= 200 && responseStatus < 300,
    rowCount,
    responseStatus,
    responseBody,
  })
}

async function collect(entity: string, f: Record<string, string>): Promise<any[]> {
  if (entity === 'users') {
    const where: any = {}
    if (f.q) {
      where.OR = [
        { name: { contains: f.q, mode: 'insensitive' } },
        { email: { contains: f.q, mode: 'insensitive' } },
        { companyName: { contains: f.q, mode: 'insensitive' } },
        { id: { contains: f.q } },
      ]
    }
    return db.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
      select: {
        id: true, name: true, email: true, companyName: true, role: true,
        createdAt: true, onboardingCompletedAt: true,
      },
    })
  }
  if (entity === 'workspaces') {
    const where: any = {}
    if (f.q) {
      where.OR = [
        { name: { contains: f.q, mode: 'insensitive' } },
        { slug: { contains: f.q, mode: 'insensitive' } },
        { id: { contains: f.q } },
      ]
    }
    if (f.plan) where.plan = f.plan
    return db.workspace.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
    })
  }
  if (entity === 'logs') {
    const where: any = {}
    if (f.status) where.status = f.status
    if (f.locationId) where.locationId = f.locationId
    if (f.agentId) where.agentId = f.agentId
    if (f.contactId) where.contactId = f.contactId
    return db.messageLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
    })
  }
  return []
}
