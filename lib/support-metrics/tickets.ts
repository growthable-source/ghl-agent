import type { Prisma } from '@prisma/client'
import type { Db, MetricScope } from './types'

/** Mean closed-at minus created-at, in hours, rounded to 0.1. Null
 *  when nothing was closed in the window. */
function avgHours(rows: Array<{ createdAt: Date; closedAt: Date | null }>): number | null {
  const deltas = rows
    .filter(r => r.closedAt)
    .map(r => (r.closedAt!.getTime() - r.createdAt.getTime()) / 3_600_000)
  if (deltas.length === 0) return null
  return Number((deltas.reduce((a, x) => a + x, 0) / deltas.length).toFixed(1))
}

export type TicketMetrics = {
  scorecards: {
    open: number
    created: number
    closed: number
    avgResolutionHours: number | null
  }
  trend: {
    deltaCreated: number
    deltaClosed: number
    deltaAvgResolutionHours: number | null
    priorCreated: number
    priorClosed: number
    priorAvgResolutionHours: number | null
  }
  byStatus: Array<{ status: string; count: number }>
  byPriority: Array<{ priority: string; count: number }>
  byBrand: Array<{
    brandId: string | null
    name: string
    color: string | null
    count: number
    openCount: number
    avgResolutionHours: number | null
  }>
  byOperator: Array<{
    userId: string
    name: string
    email: string | null
    image: string | null
    count: number
    openCount: number
    avgResolutionHours: number | null
  }>
  created: Array<{ day: string; count: number }>
  closed: Array<{ day: string; count: number }>
  allBrands: Array<{ id: string; name: string; primaryColor: string | null }>
}

/**
 * Core ticket metrics aggregation. Extracted so both the in-app reports page
 * and the external v1 metrics endpoint share exactly the same computation.
 *
 * `scope.from` / `scope.to` define the primary window.
 * `scope.brandId` mirrors the query-param semantics: 'no_brand' → unbranded
 * only; any other value → that brand; undefined → no brand filter.
 *
 * The trend/prior window is computed internally as the same-duration interval
 * immediately before [from, to): priorFrom = from − duration, priorTo = from.
 *
 * Returns the full metrics payload WITHOUT the top-level envelope
 * (inactive / days / from / to) — the caller adds those.
 *
 * IMPORTANT CONTRACT: scorecards keys are open / created / closed /
 * avgResolutionHours — do not rename them.
 */
export async function getTicketMetrics(db: Db, scope: MetricScope): Promise<TicketMetrics> {
  const { workspaceId, from: since, to: until, brandId: brandFilter } = scope

  // Compute days from the window duration (mirrors the route's existing logic)
  const days = Math.max(1, Math.ceil((until.getTime() - since.getTime()) / 86_400_000))

  // Shared base — workspace + brand filter. Date filters layer on top per query.
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

  return {
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
  }
}

/**
 * Paginated ticket list within a scope window. Cursor-based pagination.
 * Returns up to `limit` (max 200) tickets ordered by createdAt DESC,
 * plus a `nextCursor` for the next page (null when exhausted).
 */
export async function listTickets(
  db: Db,
  scope: MetricScope,
  opts: { cursor?: string; limit?: number },
) {
  const limit = Math.min(opts.limit ?? 50, 200)
  const where: Record<string, unknown> = {
    workspaceId: scope.workspaceId,
    createdAt: { gte: scope.from, lt: scope.to },
  }
  if (scope.brandId === 'no_brand') where.brandId = null
  else if (scope.brandId) where.brandId = scope.brandId
  const rows = await db.ticket.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      ticketNumber: true,
      subject: true,
      status: true,
      priority: true,
      contactEmail: true,
      contactName: true,
      assignedUserId: true,
      createdAt: true,
      closedAt: true,
      lastActivityAt: true,
      brandId: true,
    },
  })
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null }
}

/**
 * Fetch a single ticket by id, scoped to the workspace for security.
 * Returns the ticket with messages (ordered asc) or null if not found.
 */
export async function getTicket(db: Db, scope: MetricScope, id: string) {
  return db.ticket.findFirst({
    where: { id, workspaceId: scope.workspaceId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
}
