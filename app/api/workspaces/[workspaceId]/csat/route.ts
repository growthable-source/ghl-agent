import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { isMissingColumn } from '@/lib/migration-error'
import { getCsatMetrics } from '@/lib/support-metrics/csat'

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
    const result = await getCsatMetrics(db, {
      workspaceId,
      from: since,
      to: until,
      ...(brandIdFilter ? { brandId: brandIdFilter } : {}),
      ...(ratingFilter ? { rating: ratingFilter } : {}),
      ...(handlerFilter ? { handler: handlerFilter } : {}),
    })

    return NextResponse.json({
      days,
      from: since.toISOString(),
      to: until.toISOString(),
      filters: { brandId: brandIdFilter, rating: ratingFilter, handler: handlerFilter },
      totalRated: result.totalRated,
      closedTotal: result.closedTotal,
      responseRate: result.responseRate,
      averageRating: result.averageRating,
      distribution: result.distribution,
      byAgent: result.byAgent,
      byOperator: result.byOperator,
      byBrand: result.byBrand,
      byHandler: result.byHandler,
      trend: result.trend,
      commentHighlights: result.commentHighlights,
      allBrands: result.allBrands,
      recent: result.recent,
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
