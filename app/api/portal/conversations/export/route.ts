import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

const MAX_ROWS = 5000

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * GET — export the portal's conversation logs as CSV, honouring the same
 * filters as the logs page. Brand-scoped to the portal user's assigned
 * brands; capped at MAX_ROWS so a click can't pull the whole DB.
 */
export async function GET(req: NextRequest) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.brandIds.length === 0) {
    return new NextResponse('Session,Customer,Email,Brand,Channel,Handled by,CSAT,Messages,Status,Date\n', {
      headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="conversation-logs.csv"' },
    })
  }

  const sp = req.nextUrl.searchParams
  const brandSlug = (sp.get('brand') ?? '').trim()

  const allowedBrands = await db.brand.findMany({
    where: { id: { in: session.brandIds } },
    select: { id: true, name: true, slug: true },
  })
  const brandById = new Map(allowedBrands.map(b => [b.id, b]))
  const filterBrand = brandSlug ? allowedBrands.find(b => b.slug === brandSlug) ?? null : null
  const effectiveBrandIds = filterBrand ? [filterBrand.id] : session.brandIds

  const widgets = await db.chatWidget.findMany({
    where: { brandId: { in: effectiveBrandIds } },
    select: { id: true, brandId: true },
  })
  const widgetById = new Map(widgets.map(w => [w.id, w]))
  const widgetIds = widgets.map(w => w.id)

  const q = (sp.get('q') ?? '').trim()
  const from = sp.get('from')
  const to = sp.get('to')
  const fromDate = from ? new Date(from) : null
  const toDate = to ? new Date(to + 'T23:59:59') : null

  const where: Record<string, unknown> = { widgetId: { in: widgetIds } }
  if (sp.get('handled') === 'ai') where.assignedUserId = null
  else if (sp.get('handled') === 'human') where.assignedUserId = { not: null }
  const status = sp.get('status')
  if (status === 'active' || status === 'ended') where.status = status
  if (sp.get('channel') === 'voice') where.voiceCalls = { some: {} }
  else if (sp.get('channel') === 'live_chat') where.voiceCalls = { none: {} }
  if (fromDate && !isNaN(fromDate.getTime())) where.lastMessageAt = { ...(where.lastMessageAt as object ?? {}), gte: fromDate }
  if (toDate && !isNaN(toDate.getTime())) where.lastMessageAt = { ...(where.lastMessageAt as object ?? {}), lte: toDate }
  if (q) {
    where.OR = [
      { visitor: { name: { contains: q, mode: 'insensitive' } } },
      { visitor: { email: { contains: q, mode: 'insensitive' } } },
      { id: { contains: q } },
    ]
  }

  const rows = widgetIds.length === 0 ? [] : await db.widgetConversation.findMany({
    where,
    orderBy: { lastMessageAt: 'desc' },
    take: MAX_ROWS,
    select: {
      id: true, widgetId: true, status: true, csatRating: true, lastMessageAt: true,
      assignedUserId: true,
      assignedUser: { select: { name: true, email: true } },
      visitor: { select: { name: true, email: true } },
      _count: { select: { messages: true } },
      voiceCalls: { select: { id: true }, take: 1 },
    },
  })

  const header = ['Session', 'Customer', 'Email', 'Brand', 'Channel', 'Handled by', 'CSAT', 'Messages', 'Status', 'Date']
  const lines = [header.join(',')]
  for (const c of rows) {
    const brand = c.widgetId ? brandById.get(widgetById.get(c.widgetId)?.brandId ?? '') : null
    lines.push([
      `#${c.id.slice(-6).toUpperCase()}`,
      c.visitor.name ?? 'Anonymous',
      c.visitor.email ?? '',
      brand?.name ?? '',
      c.voiceCalls.length > 0 ? 'Voice' : 'Live Chat',
      c.assignedUserId ? (c.assignedUser?.name ?? c.assignedUser?.email ?? 'Human') : 'AI agent',
      c.csatRating ?? '',
      c._count.messages,
      c.status,
      c.lastMessageAt.toISOString(),
    ].map(csvCell).join(','))
  }

  return new NextResponse(lines.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="conversation-logs-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
