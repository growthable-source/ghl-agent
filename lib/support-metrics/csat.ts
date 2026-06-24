import type { Prisma } from '@prisma/client'
import type { Db, MetricScope } from './types'

export type CsatScope = MetricScope & { rating?: number; handler?: 'ai' | 'human' }

/**
 * Core CSAT aggregation. Accepts a fully-resolved scope (workspaceId,
 * date window, optional filters) and returns every aggregate the CSAT
 * dashboard needs — scorecards, per-agent/operator/brand rollups, trend,
 * comment highlights, recent list, and a `scorecards` convenience object
 * for callers that only need the headline numbers (e.g. the overview
 * composer).
 *
 * Returns the full payload MINUS the top-level window envelope
 * (days/from/to/filters), which the route adds back so the HTTP shape
 * stays identical to what the page has always received.
 */
export async function getCsatMetrics(db: Db, scope: CsatScope) {
  const since = scope.from
  const until = scope.to
  const workspaceId = scope.workspaceId
  const brandIdFilter = scope.brandId ?? null
  const ratingFilter = scope.rating ?? null
  const handlerFilter = scope.handler ?? null

  // Compute `days` for the prior-period comparison.
  const days = Math.max(1, Math.ceil((until.getTime() - since.getTime()) / 86_400_000))

  // Widgets — optionally narrowed to one brand. We pull widget.brand
  // for the per-brand rollup too.
  const widgets = await db.chatWidget.findMany({
    where: {
      workspaceId,
      ...(brandIdFilter ? { brandId: brandIdFilter } : {}),
    },
    select: {
      id: true, name: true, brandId: true,
      brand: { select: { id: true, name: true, primaryColor: true } },
    },
  })
  const widgetIds = widgets.map(w => w.id)

  if (widgetIds.length === 0) {
    const empty = emptyResult()
    return empty
  }

  // Handler filter folds into the conversation where clause —
  // assignedAt is the canonical "a human was ever on this" signal.
  const handlerWhere: Prisma.WidgetConversationWhereInput =
    handlerFilter === 'human' ? { assignedAt: { not: null } }
    : handlerFilter === 'ai'  ? { assignedAt: null }
    : {}

  const ratedConvos = await db.widgetConversation.findMany({
    where: {
      widgetId: { in: widgetIds },
      csatRating: { not: null, ...(ratingFilter ? { equals: ratingFilter } : {}) },
      csatSubmittedAt: { gte: since, lte: until },
      ...handlerWhere,
    },
    select: {
      id: true,
      widgetId: true,
      agentId: true,
      csatRating: true,
      csatComment: true,
      csatSubmittedAt: true,
      assignedAt: true,
      assignedUserId: true,
      visitor: { select: { name: true, email: true } },
    },
    orderBy: { csatSubmittedAt: 'desc' },
    take: 500,
  })

  // Anchor: response rate against closed chats. Same filters apply
  // so the "x of y rated" line reflects the active drill-down.
  const closedTotal = await db.widgetConversation.count({
    where: {
      widgetId: { in: widgetIds },
      status: 'ended',
      lastMessageAt: { gte: since, lte: until },
      ...handlerWhere,
    },
  })

  const agentIds = Array.from(
    new Set(ratedConvos.map(c => c.agentId).filter((id): id is string => !!id))
  )
  const agents = agentIds.length
    ? await db.agent.findMany({
        where: { id: { in: agentIds } },
        select: { id: true, name: true },
      })
    : []
  const agentNameById = new Map(agents.map(a => [a.id, a.name]))
  const widgetById = new Map(widgets.map(w => [w.id, w]))

  // Human operator lookup — pull every User assignedUserId mentioned
  // in the rated conversations so we can render a per-human rollup
  // alongside the per-AI-agent one.
  const operatorIds = Array.from(
    new Set(ratedConvos.map(c => c.assignedUserId).filter((id): id is string => !!id))
  )
  const operators = operatorIds.length
    ? await db.user.findMany({
        where: { id: { in: operatorIds } },
        select: { id: true, name: true, email: true, image: true },
      })
    : []
  const operatorById = new Map(operators.map(u => [u.id, u]))

  const totalRated = ratedConvos.length
  const sumRatings = ratedConvos.reduce((acc, c) => acc + (c.csatRating ?? 0), 0)
  const avg = totalRated > 0 ? sumRatings / totalRated : 0

  const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const c of ratedConvos) {
    const r = c.csatRating as 1 | 2 | 3 | 4 | 5
    if (r >= 1 && r <= 5) distribution[r] += 1
  }

  // Per-agent rollup.
  const byAgent = rollup(
    ratedConvos,
    c => c.agentId,
    c => ({
      agentId: c.agentId,
      name: c.agentId ? (agentNameById.get(c.agentId) || 'Agent') : '(no agent)',
    }),
    c => c.csatRating ?? 0,
    { unkeyedBucket: '(no agent)' },
  )

  // Per-human-operator rollup. Drops conversations that were never
  // assigned to a human (no userId to bucket under).
  const byOperator = rollup(
    ratedConvos,
    c => c.assignedUserId,
    c => {
      const op = operatorById.get(c.assignedUserId!)!
      return {
        userId: c.assignedUserId!,
        name: op.name || op.email || 'Teammate',
        email: op.email ?? null,
        image: op.image ?? null,
      }
    },
    c => c.csatRating ?? 0,
    { dropUnkeyed: true },
  )

  // Per-brand rollup. Widgets without a brand bucket under "(no brand)".
  const byBrand = rollup(
    ratedConvos,
    c => widgetById.get(c.widgetId)?.brand?.id ?? null,
    c => {
      const brand = widgetById.get(c.widgetId)?.brand
      return {
        brandId: brand?.id ?? null,
        name: brand?.name ?? '(no brand)',
        color: brand?.primaryColor ?? null,
      }
    },
    c => c.csatRating ?? 0,
  )

  // AI vs human breakdown — re-query without handler filter so both
  // sides stay populated even when the user drills into one handler.
  let byHandlerAi: { count: number; avg: number } = { count: 0, avg: 0 }
  let byHandlerHuman: { count: number; avg: number } = { count: 0, avg: 0 }
  if (handlerFilter) {
    const allInWindow = await db.widgetConversation.findMany({
      where: {
        widgetId: { in: widgetIds },
        csatRating: { not: null, ...(ratingFilter ? { equals: ratingFilter } : {}) },
        csatSubmittedAt: { gte: since, lte: until },
      },
      select: { csatRating: true, assignedAt: true },
    })
    byHandlerAi = avgFor(allInWindow.filter(c => !c.assignedAt))
    byHandlerHuman = avgFor(allInWindow.filter(c => c.assignedAt))
  } else {
    byHandlerAi = avgFor(ratedConvos.filter(c => !c.assignedAt))
    byHandlerHuman = avgFor(ratedConvos.filter(c => c.assignedAt))
  }

  // Period-over-period trend — compare against the same window
  // shifted back by `days`.
  const priorSince = new Date(since.getTime() - days * 86_400_000)
  const priorRated = await db.widgetConversation.aggregate({
    where: {
      widgetId: { in: widgetIds },
      csatRating: { not: null, ...(ratingFilter ? { equals: ratingFilter } : {}) },
      csatSubmittedAt: { gte: priorSince, lt: since },
      ...handlerWhere,
    },
    _avg: { csatRating: true },
    _count: { csatRating: true },
  })
  const priorClosedTotal = await db.widgetConversation.count({
    where: {
      widgetId: { in: widgetIds },
      status: 'ended',
      lastMessageAt: { gte: priorSince, lt: since },
      ...handlerWhere,
    },
  })
  const priorAvg = priorRated._avg.csatRating ?? null
  const priorCount = priorRated._count.csatRating ?? 0
  const priorResponseRate = priorClosedTotal > 0 ? priorCount / priorClosedTotal : 0
  const trend = {
    priorAvg: priorAvg !== null ? Number(priorAvg.toFixed(2)) : null,
    priorCount,
    priorResponseRate: Number(priorResponseRate.toFixed(3)),
    deltaAvg: priorAvg !== null ? Number((avg - priorAvg).toFixed(2)) : null,
    deltaCount: totalRated - priorCount,
    deltaResponseRate: closedTotal > 0
      ? Number(((closedTotal > 0 ? totalRated / closedTotal : 0) - priorResponseRate).toFixed(3))
      : 0,
  }

  // Comment highlights — lowest-rated with comments → "Needs review";
  // highest-rated with comments → "Bright spots". Both capped at 5.
  const withComments = ratedConvos.filter(c => c.csatComment && c.csatComment.trim().length > 0)
  const lowestRated = [...withComments]
    .filter(c => (c.csatRating ?? 5) <= 3)
    .sort((a, b) => (a.csatRating ?? 0) - (b.csatRating ?? 0))
    .slice(0, 5)
  const highestRated = [...withComments]
    .filter(c => (c.csatRating ?? 0) >= 4)
    .sort((a, b) => (b.csatRating ?? 0) - (a.csatRating ?? 0))
    .slice(0, 5)
  const summariseComment = (c: typeof ratedConvos[number]) => {
    const widget = widgetById.get(c.widgetId)
    return {
      conversationId: c.id,
      widgetName: widget?.name || 'Widget',
      brandName: widget?.brand?.name ?? null,
      agentName: c.agentId ? (agentNameById.get(c.agentId) || 'Agent') : null,
      operatorName: c.assignedUserId
        ? (operatorById.get(c.assignedUserId)?.name || operatorById.get(c.assignedUserId)?.email || 'Operator')
        : null,
      handler: c.assignedAt ? 'human' as const : 'ai' as const,
      rating: c.csatRating ?? 0,
      comment: c.csatComment ?? '',
      submittedAt: c.csatSubmittedAt?.toISOString() ?? null,
      visitorLabel: c.visitor?.name || c.visitor?.email || 'Anonymous visitor',
    }
  }

  const recent = ratedConvos.slice(0, 30).map(c => {
    const widget = widgetById.get(c.widgetId)
    return {
      conversationId: c.id,
      widgetId: c.widgetId,
      widgetName: widget?.name || 'Widget',
      brandId: widget?.brand?.id ?? null,
      brandName: widget?.brand?.name ?? null,
      agentId: c.agentId,
      agentName: c.agentId ? (agentNameById.get(c.agentId) || 'Agent') : null,
      handler: c.assignedAt ? 'human' as const : 'ai' as const,
      rating: c.csatRating,
      comment: c.csatComment,
      submittedAt: c.csatSubmittedAt?.toISOString() ?? null,
      visitorLabel: c.visitor?.name || c.visitor?.email || 'Anonymous visitor',
    }
  })

  // All brands in the workspace (regardless of whether they have
  // ratings in this window) so the filter UI can show every brand
  // option with "0 ratings" rather than dropping unrated brands.
  const allBrands = await db.brand.findMany({
    where: { workspaceId },
    select: { id: true, name: true, primaryColor: true },
    orderBy: { name: 'asc' },
  })

  const responseRate = closedTotal > 0 ? totalRated / closedTotal : 0
  const averageRating = Number(avg.toFixed(2))

  // `scorecards` is a convenience sub-object for callers that only need
  // headline numbers (e.g. the overview composer). The route also returns
  // the same values at the top level for backward compat with the page.
  const scorecards = {
    totalRated,
    responseRate,
    avgRating: averageRating,
    breakdown: distribution,
  }

  return {
    // Headline numbers (flat — preserved for the in-app page)
    totalRated,
    closedTotal,
    responseRate,
    averageRating,
    distribution,
    // Rollups
    byAgent,
    byOperator,
    byBrand,
    byHandler: { ai: byHandlerAi, human: byHandlerHuman },
    trend,
    commentHighlights: {
      needsReview: lowestRated.map(summariseComment),
      brightSpots: highestRated.map(summariseComment),
    },
    allBrands,
    recent,
    // Convenience object for the overview composer
    scorecards,
  }
}

/**
 * Cursor-paginated list of raw CSAT responses. Used by the external
 * /api/v1/csat/* endpoints for drill-down — NOT wired into the in-app
 * route (which uses getCsatMetrics instead).
 */
export async function listCsatResponses(
  db: Db,
  scope: CsatScope,
  opts: { cursor?: string; limit?: number },
) {
  const limit = Math.min(opts.limit ?? 50, 200)
  const where: Prisma.WidgetConversationWhereInput = {
    csatSubmittedAt: { gte: scope.from, lt: scope.to },
    widget: { workspaceId: scope.workspaceId },
  }
  if (scope.rating) where.csatRating = scope.rating
  if (scope.brandId) where.widget = { ...where.widget as object, brandId: scope.brandId }
  if (scope.handler === 'human') where.assignedAt = { not: null }
  if (scope.handler === 'ai') where.assignedAt = null

  const rows = await db.widgetConversation.findMany({
    where,
    orderBy: { csatSubmittedAt: 'desc' },
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true, csatRating: true, csatComment: true, csatSubmittedAt: true,
      assignedUserId: true, agentId: true,
    },
  })
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null }
}

// ---------------------------------------------------------------------------
// Internal helpers (mirrors of what was in the route, kept here so both
// getCsatMetrics and any future callers can share them)
// ---------------------------------------------------------------------------

/**
 * Generic single-pass group-by-and-average. Used for byAgent /
 * byOperator / byBrand rollups.
 */
function rollup<Row, Payload extends Record<string, unknown>>(
  rows: Row[],
  keyOf: (row: Row) => string | null | undefined,
  payloadOf: (row: Row) => Payload,
  ratingOf: (row: Row) => number,
  opts: { dropUnkeyed?: boolean; unkeyedBucket?: string } = {},
): Array<Payload & { count: number; avg: number }> {
  const buckets = new Map<string, Payload & { count: number; sum: number; avg: number }>()
  for (const row of rows) {
    const rawKey = keyOf(row)
    if (rawKey == null && opts.dropUnkeyed) continue
    const key = rawKey ?? (opts.unkeyedBucket ?? '∅')
    const rating = ratingOf(row)
    const existing = buckets.get(key)
    if (existing) {
      existing.count += 1
      existing.sum += rating
      existing.avg = existing.sum / existing.count
    } else {
      buckets.set(key, { ...payloadOf(row), count: 1, sum: rating, avg: rating })
    }
  }
  return Array.from(buckets.values())
    .map(({ sum: _sum, ...rest }) => rest as Payload & { count: number; avg: number })
    .sort((a, b) => b.count - a.count)
}

function avgFor(rows: Array<{ csatRating: number | null }>): { count: number; avg: number } {
  const filtered = rows.filter(r => r.csatRating !== null)
  if (filtered.length === 0) return { count: 0, avg: 0 }
  const sum = filtered.reduce((acc, r) => acc + (r.csatRating ?? 0), 0)
  return { count: filtered.length, avg: Number((sum / filtered.length).toFixed(2)) }
}

function emptyResult() {
  return {
    totalRated: 0,
    closedTotal: 0,
    responseRate: 0,
    averageRating: 0,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>,
    byAgent: [] as ReturnType<typeof rollup>[],
    byOperator: [] as ReturnType<typeof rollup>[],
    byBrand: [] as ReturnType<typeof rollup>[],
    byHandler: { ai: { count: 0, avg: 0 }, human: { count: 0, avg: 0 } },
    trend: {
      priorAvg: null as number | null,
      priorCount: 0,
      priorResponseRate: 0,
      deltaAvg: null as number | null,
      deltaCount: 0,
      deltaResponseRate: 0,
    },
    commentHighlights: { needsReview: [] as unknown[], brightSpots: [] as unknown[] },
    allBrands: [] as { id: string; name: string; primaryColor: string | null }[],
    recent: [] as unknown[],
    scorecards: { totalRated: 0, responseRate: 0, avgRating: 0, breakdown: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number> },
  }
}
