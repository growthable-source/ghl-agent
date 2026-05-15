import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { isMissingColumn } from '@/lib/migration-error'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:workspaceId/csat
 *
 * Query params:
 *   days     — 1..180 (default 30) — trailing window
 *   brandId  — optional, restrict to widgets tagged to this brand
 *   rating   — optional, restrict to a single star value (1..5)
 *   handler  — optional, 'ai' | 'human' — drill into AI-only vs
 *              human-touched conversations
 *
 * The page supports click-to-filter on the bars / brand rows / handler
 * pill, so the API has to recompute every aggregate (scorecards,
 * distribution, breakdowns, recent list) under whichever filter is
 * active. Filtering happens at the SQL `where` level so we don't
 * over-fetch.
 *
 * `handler` classification:
 *   - 'human' = the conversation has assignedAt set (a human was ever
 *     assigned to it). The handoff flow sets this on takeover.
 *   - 'ai'    = no assignment ever happened; AI carried the whole chat.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  // Date window. Two ways to specify:
  //   ?days=30                              → trailing N days from now
  //   ?from=2026-04-01&to=2026-05-15        → explicit [from, to) range
  // `from` / `to` take precedence when both present. We still report
  // `days` in the response so the dashboard tab knows what's active.
  const fromParam = url.searchParams.get('from')
  const toParam = url.searchParams.get('to')
  let since: Date
  let until: Date
  let days: number
  if (fromParam && toParam && !Number.isNaN(Date.parse(fromParam)) && !Number.isNaN(Date.parse(toParam))) {
    since = new Date(fromParam)
    until = new Date(toParam)
    // Include the entire `to` day rather than stopping at 00:00 — the
    // calendar UI sends a date, not a datetime, so 2026-05-15 means
    // "through end of May 15."
    until.setHours(23, 59, 59, 999)
    days = Math.max(1, Math.ceil((until.getTime() - since.getTime()) / 86_400_000))
  } else {
    days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30))
    since = new Date(Date.now() - days * 86_400_000)
    until = new Date()
  }
  const brandIdFilter = url.searchParams.get('brandId') || null
  const ratingFilterRaw = url.searchParams.get('rating')
  const ratingFilter = ratingFilterRaw && /^[1-5]$/.test(ratingFilterRaw) ? Number(ratingFilterRaw) : null
  const handlerFilterRaw = url.searchParams.get('handler')
  const handlerFilter = handlerFilterRaw === 'ai' || handlerFilterRaw === 'human' ? handlerFilterRaw : null

  try {
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
      return NextResponse.json(empty(days))
    }

    // Handler filter folds into the conversation where clause —
    // assignedAt is the canonical "a human was ever on this" signal.
    // Typed as Prisma's WidgetConversationWhereInput fragment so we
    // can spread it into both findMany and count without `as any`.
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
    // alongside the per-AI-agent one. The two answer different questions:
    //   - By AI agent: which agent config is producing happy chats?
    //   - By human operator: which teammate is keeping ratings high
    //     on the chats they took over?
    // A conversation can appear in BOTH (AI → human handoff) because
    // the rating reflects the overall experience and both touched it.
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

    // Per-human-operator rollup. Same shape as byAgent but keyed off
    // assignedUserId. Drops conversations that were never assigned to
    // a human (no userId to bucket under).
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

    // AI vs human breakdown — only meaningful when not already filtered
    // by handler (otherwise one side is always zero). When `handler` is
    // active we still return both sides computed against the same
    // window so the comparison stays useful.
    let byHandlerAi: { count: number; avg: number } = { count: 0, avg: 0 }
    let byHandlerHuman: { count: number; avg: number } = { count: 0, avg: 0 }
    if (handlerFilter) {
      // Re-query the raw counts WITHOUT the handler filter so the
      // comparison card shows both sides side-by-side. We don't want
      // the filter to make the comparison panel collapse to "AI: 0".
      const allInWindow = await db.widgetConversation.findMany({
        where: {
          widgetId: { in: widgetIds },
          csatRating: { not: null, ...(ratingFilter ? { equals: ratingFilter } : {}) },
          csatSubmittedAt: { gte: since, lte: until },
        },
        select: { csatRating: true, assignedAt: true },
      })
      // (used downstream — keeps both AI + human sides populated even
      // when the handler filter is active)
      byHandlerAi = avgFor(allInWindow.filter(c => !c.assignedAt))
      byHandlerHuman = avgFor(allInWindow.filter(c => c.assignedAt))
    } else {
      byHandlerAi = avgFor(ratedConvos.filter(c => !c.assignedAt))
      byHandlerHuman = avgFor(ratedConvos.filter(c => c.assignedAt))
    }

    // Period-over-period trend — compare against the same window
     // shifted back by `days`. Lets us say "+0.12 vs last 30d" or
     // "−0.4 vs last 30d" so admins can see whether things are
     // getting better or worse. Single aggregate query — fast.
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

    // Comment highlights — what to actually READ. Lowest-rated chats
    // with a comment go to "Needs review"; highest-rated with a
    // comment go to "Bright spots". Both capped at 5. These are far
    // more actionable than the full recent list because they're
    // signal-rich (comment present) and sorted by urgency.
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

    return NextResponse.json({
      days,
      from: since.toISOString(),
      to: until.toISOString(),
      filters: { brandId: brandIdFilter, rating: ratingFilter, handler: handlerFilter },
      totalRated,
      closedTotal,
      responseRate: closedTotal > 0 ? totalRated / closedTotal : 0,
      averageRating: Number(avg.toFixed(2)),
      distribution,
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
    })
  } catch (err: unknown) {
    if (isMissingColumn(err)) {
      return NextResponse.json({
        ...empty(days),
        notMigrated: true,
        error: "CSAT columns aren't migrated yet. Run prisma/migrations-legacy/manual_widget_csat.sql.",
      })
    }
    const msg = err instanceof Error ? err.message : 'Failed to load CSAT'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * Generic single-pass group-by-and-average. Used for byAgent /
 * byOperator / byBrand rollups — they're all "bucket conversations
 * by some key, attach a display payload, average the rating."
 *
 *   rollup(rows, keyOf, payloadOf, ratingOf)
 *
 *   keyOf       - returns the bucket key (string | null). Null/undefined
 *                 keys go into the unkeyed bucket unless `dropUnkeyed`
 *                 is set, in which case they're skipped.
 *   payloadOf   - returns the bucket's display fields (name, ids, etc).
 *                 Only called once per bucket (first row that maps to it).
 *   ratingOf    - returns the numeric rating for this row.
 *   opts.dropUnkeyed   - silently skip rows with null/undefined key
 *   opts.unkeyedBucket - display name for the null-key bucket (default '∅')
 *
 * Returns the bucket list sorted by count desc — the same order the
 * old hand-rolled rollups used.
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
  // Strip `sum` from the public shape — it was only carried for the
  // running average. Caller doesn't need it.
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

function empty(days = 30) {
  return {
    days,
    filters: { brandId: null, rating: null, handler: null },
    totalRated: 0,
    closedTotal: 0,
    responseRate: 0,
    averageRating: 0,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    byAgent: [],
    byOperator: [],
    byBrand: [],
    byHandler: { ai: { count: 0, avg: 0 }, human: { count: 0, avg: 0 } },
    trend: { priorAvg: null, priorCount: 0, priorResponseRate: 0, deltaAvg: null, deltaCount: 0, deltaResponseRate: 0 },
    commentHighlights: { needsReview: [], brightSpots: [] },
    allBrands: [],
    recent: [],
  }
}
