import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { getTicketingStatus } from '@/lib/ticketing-access'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:ws/tickets/reports
 *
 * Query params (all optional, all combine):
 *   days     1..365 (default 30) — trailing-days bucket
 *   from/to  YYYY-MM-DD — explicit range, overrides days
 *   brandId  scope to one brand; 'no_brand' = unbranded only
 *   handler  'ai' | 'human' — not used here, reserved for parity
 *            with CSAT
 *
 * Returns the data shapes the reports page renders:
 *   scorecards         { open, created, closed, avgResolutionHours }
 *   trend              previous-window deltas for each scorecard
 *   byStatus           [{ status, count }]
 *   byPriority         [{ priority, count }]
 *   byBrand            [{ brandId, name, color, count, openCount,
 *                         avgResolutionHours }]
 *   byOperator         [{ userId, name, email, image, count,
 *                         openCount, avgResolutionHours }]
 *   created            [{ day: 'YYYY-MM-DD', count }] daily series
 *   closed             [{ day: 'YYYY-MM-DD', count }] daily series
 *   allBrands          brand picker source-of-truth
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const status = await getTicketingStatus(workspaceId)
  if (!status.active) {
    return NextResponse.json({ inactive: true, reason: status.reason })
  }

  const url = new URL(req.url)
  const fromParam = url.searchParams.get('from')
  const toParam = url.searchParams.get('to')
  let since: Date
  let until: Date
  let days: number
  if (fromParam && toParam && !Number.isNaN(Date.parse(fromParam)) && !Number.isNaN(Date.parse(toParam))) {
    since = new Date(fromParam)
    until = new Date(toParam)
    until.setHours(23, 59, 59, 999)
    days = Math.max(1, Math.ceil((until.getTime() - since.getTime()) / 86_400_000))
  } else {
    days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30))
    since = new Date(Date.now() - days * 86_400_000)
    until = new Date()
  }
  const brandFilter = url.searchParams.get('brandId')

  // Shared base — workspace + brand filter. Date filters layer on
  // top per query depending on what's being measured.
  const base: Prisma.TicketWhereInput = { workspaceId }
  if (brandFilter === 'no_brand') {
    base.brandId = null
  } else if (brandFilter) {
    base.brandId = brandFilter
  }

  // ── Scorecards ─────────────────────────────────────────────────────
  // open    — currently open + pending + on_hold (snapshot, not window)
  // created — opened in window
  // closed  — closed in window
  const [openCount, createdCount, closedCount, resolutionStats] = await Promise.all([
    db.ticket.count({ where: { ...base, status: { in: ['open', 'pending', 'on_hold'] } } }),
    db.ticket.count({ where: { ...base, createdAt: { gte: since, lte: until } } }),
    db.ticket.count({ where: { ...base, closedAt: { gte: since, lte: until, not: null } } }),
    // Avg resolution time over tickets closed in window. We compute
    // in JS because Prisma's aggregate doesn't support derived
    // expressions; the count is small enough (one row per closed
    // ticket) that this is fine.
    db.ticket.findMany({
      where: { ...base, closedAt: { gte: since, lte: until, not: null } },
      select: { createdAt: true, closedAt: true },
    }),
  ])

  const avgResolutionHours = avgHours(resolutionStats)

  // ── Trend (prior window) ───────────────────────────────────────────
  const priorSince = new Date(since.getTime() - days * 86_400_000)
  const [priorCreated, priorClosed, priorResolutionStats] = await Promise.all([
    db.ticket.count({ where: { ...base, createdAt: { gte: priorSince, lt: since } } }),
    db.ticket.count({ where: { ...base, closedAt: { gte: priorSince, lt: since, not: null } } }),
    db.ticket.findMany({
      where: { ...base, closedAt: { gte: priorSince, lt: since, not: null } },
      select: { createdAt: true, closedAt: true },
    }),
  ])
  const priorAvgResolutionHours = avgHours(priorResolutionStats)

  // ── Distributions in window ────────────────────────────────────────
  const tickets = await db.ticket.findMany({
    where: { ...base, createdAt: { gte: since, lte: until } },
    select: {
      status: true,
      priority: true,
      brandId: true,
      assignedUserId: true,
      createdAt: true,
      closedAt: true,
      brand: { select: { id: true, name: true, primaryColor: true } },
      assignedUser: { select: { id: true, name: true, email: true, image: true } },
    },
  })

  const byStatusMap = new Map<string, number>()
  for (const t of tickets) byStatusMap.set(t.status, (byStatusMap.get(t.status) ?? 0) + 1)
  const byStatus = Array.from(byStatusMap.entries()).map(([status, count]) => ({ status, count }))

  const byPriorityMap = new Map<string, number>()
  for (const t of tickets) byPriorityMap.set(t.priority, (byPriorityMap.get(t.priority) ?? 0) + 1)
  const byPriority = ['urgent', 'high', 'normal', 'low']
    .map(p => ({ priority: p, count: byPriorityMap.get(p) ?? 0 }))

  // ── By brand ───────────────────────────────────────────────────────
  type BrandRow = {
    brandId: string | null; name: string; color: string | null
    count: number; openCount: number; resolutionDeltas: number[]
  }
  const byBrandMap = new Map<string, BrandRow>()
  for (const t of tickets) {
    const key = t.brandId ?? '∅'
    const existing = byBrandMap.get(key) ?? {
      brandId: t.brandId,
      name: t.brand?.name ?? '(no brand)',
      color: t.brand?.primaryColor ?? null,
      count: 0,
      openCount: 0,
      resolutionDeltas: [],
    }
    existing.count += 1
    if (['open', 'pending', 'on_hold'].includes(t.status)) existing.openCount += 1
    if (t.closedAt) existing.resolutionDeltas.push(t.closedAt.getTime() - t.createdAt.getTime())
    byBrandMap.set(key, existing)
  }
  const byBrand = Array.from(byBrandMap.values())
    .map(b => ({
      brandId: b.brandId, name: b.name, color: b.color,
      count: b.count, openCount: b.openCount,
      avgResolutionHours: b.resolutionDeltas.length
        ? Number((b.resolutionDeltas.reduce((a, x) => a + x, 0) / b.resolutionDeltas.length / 3_600_000).toFixed(1))
        : null,
    }))
    .sort((a, b) => b.count - a.count)

  // ── By operator (human assignee) ───────────────────────────────────
  type OpRow = {
    userId: string; name: string; email: string | null; image: string | null
    count: number; openCount: number; resolutionDeltas: number[]
  }
  const byOpMap = new Map<string, OpRow>()
  for (const t of tickets) {
    if (!t.assignedUserId || !t.assignedUser) continue
    const key = t.assignedUserId
    const existing = byOpMap.get(key) ?? {
      userId: t.assignedUserId,
      name: t.assignedUser.name || t.assignedUser.email || 'Teammate',
      email: t.assignedUser.email,
      image: t.assignedUser.image,
      count: 0, openCount: 0, resolutionDeltas: [],
    }
    existing.count += 1
    if (['open', 'pending', 'on_hold'].includes(t.status)) existing.openCount += 1
    if (t.closedAt) existing.resolutionDeltas.push(t.closedAt.getTime() - t.createdAt.getTime())
    byOpMap.set(key, existing)
  }
  const byOperator = Array.from(byOpMap.values())
    .map(o => ({
      userId: o.userId, name: o.name, email: o.email, image: o.image,
      count: o.count, openCount: o.openCount,
      avgResolutionHours: o.resolutionDeltas.length
        ? Number((o.resolutionDeltas.reduce((a, x) => a + x, 0) / o.resolutionDeltas.length / 3_600_000).toFixed(1))
        : null,
    }))
    .sort((a, b) => b.count - a.count)

  // ── Daily series (created vs closed) ───────────────────────────────
  // Bucket by YYYY-MM-DD in workspace UTC. For small windows this is
  // a single pass; for 365 days it's still a few thousand rows max.
  const dayKey = (d: Date) => d.toISOString().slice(0, 10)
  const createdByDay = new Map<string, number>()
  const closedByDay = new Map<string, number>()
  for (const t of tickets) {
    const k = dayKey(t.createdAt)
    createdByDay.set(k, (createdByDay.get(k) ?? 0) + 1)
    if (t.closedAt) {
      const ck = dayKey(t.closedAt)
      closedByDay.set(ck, (closedByDay.get(ck) ?? 0) + 1)
    }
  }
  // Walk the window so the series has rows for empty days too.
  const created: Array<{ day: string; count: number }> = []
  const closed: Array<{ day: string; count: number }> = []
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 86_400_000)
    const k = dayKey(d)
    created.push({ day: k, count: createdByDay.get(k) ?? 0 })
    closed.push({ day: k, count: closedByDay.get(k) ?? 0 })
  }

  // ── Brand picker source-of-truth ───────────────────────────────────
  const allBrands = await db.brand.findMany({
    where: { workspaceId },
    select: { id: true, name: true, primaryColor: true },
    orderBy: { name: 'asc' },
  })

  return NextResponse.json({
    inactive: false,
    days,
    from: since.toISOString(),
    to: until.toISOString(),
    filters: { brandId: brandFilter ?? null },
    scorecards: {
      open: openCount,
      created: createdCount,
      closed: closedCount,
      avgResolutionHours,
    },
    trend: {
      deltaCreated: createdCount - priorCreated,
      deltaClosed: closedCount - priorClosed,
      deltaAvgResolutionHours: priorAvgResolutionHours !== null && avgResolutionHours !== null
        ? Number((avgResolutionHours - priorAvgResolutionHours).toFixed(1))
        : null,
      priorCreated,
      priorClosed,
      priorAvgResolutionHours,
    },
    byStatus,
    byPriority,
    byBrand,
    byOperator,
    created,
    closed,
    allBrands,
  })
}

/** Mean closed-at minus created-at, in hours, rounded to 0.1. Null
 *  when nothing was closed in the window. */
function avgHours(rows: Array<{ createdAt: Date; closedAt: Date | null }>): number | null {
  const deltas = rows
    .filter(r => r.closedAt)
    .map(r => (r.closedAt!.getTime() - r.createdAt.getTime()) / 3_600_000)
  if (deltas.length === 0) return null
  return Number((deltas.reduce((a, x) => a + x, 0) / deltas.length).toFixed(1))
}
