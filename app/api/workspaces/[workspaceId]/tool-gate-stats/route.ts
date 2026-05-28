/**
 * GET /api/workspaces/:workspaceId/tool-gate-stats?days=N
 *
 * Aggregates ToolGateDecision rows (Phase B3 enforced-tool gate audit log)
 * for all agents in the workspace and returns a human-readable rollup:
 *   - overall counts (total / allowed / blocked)
 *   - p50 / p95 gate latency (computed in JS — these tables stay small)
 *   - total input / output tokens spent on gate calls
 *   - per-tool breakdown with top 3 block reasons
 *   - last 20 blocked decisions for quick scanning
 *
 * Window is clamped to [1, 90] days (defaults 14) to keep table reads
 * bounded regardless of caller input.
 *
 * Auth: workspace membership via requireWorkspaceAccess. Any member of
 * the workspace can see gate stats for every agent in it.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

const DEFAULT_DAYS = 14
const MAX_DAYS = 90
const MIN_DAYS = 1

function clampDays(raw: string | null): number {
  const parsed = parseInt(raw || '', 10)
  if (!Number.isFinite(parsed)) return DEFAULT_DAYS
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, parsed))
}

/** Percentile by sort + index. Returns 0 for an empty list so callers
 *  don't have to handle NaN downstream. p must be in [0,1]. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[idx]
}

export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const windowDays = clampDays(url.searchParams.get('days'))
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)

  // Resolve agents owned by this workspace. We filter ToolGateDecision
  // by agentId rather than walking through the relation so the index
  // on (agentId, createdAt) is usable.
  const agents = await db.agent.findMany({
    where: { workspaceId },
    select: { id: true },
  })
  const agentIds = agents.map(a => a.id)

  if (agentIds.length === 0) {
    return NextResponse.json({
      windowDays,
      totalChecks: 0,
      allowed: 0,
      blocked: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      byTool: [],
      recentBlocked: [],
    })
  }

  // One pass for the rows we actually need to inspect. Selecting only
  // the columns required keeps payload bounded even on bursty windows.
  const rows = await db.toolGateDecision.findMany({
    where: {
      agentId: { in: agentIds },
      createdAt: { gte: since },
    },
    select: {
      id: true,
      agentId: true,
      toolName: true,
      decision: true,
      reason: true,
      latencyMs: true,
      inputTokens: true,
      outputTokens: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  let allowed = 0
  let blocked = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  const latencies: number[] = []

  // Per-tool aggregation. We collect latencies inline so we can compute
  // a per-tool p50 in the same pass without a second table scan.
  type ToolAgg = {
    toolName: string
    allowed: number
    blocked: number
    latencies: number[]
    reasonCounts: Map<string, number>
  }
  const byToolMap = new Map<string, ToolAgg>()

  const recentBlocked: Array<{
    id: string
    agentId: string
    toolName: string
    reason: string
    createdAt: string
  }> = []

  for (const r of rows) {
    if (r.decision === 'allowed') allowed++
    else if (r.decision === 'blocked') blocked++
    totalInputTokens += r.inputTokens ?? 0
    totalOutputTokens += r.outputTokens ?? 0
    latencies.push(r.latencyMs)

    let agg = byToolMap.get(r.toolName)
    if (!agg) {
      agg = {
        toolName: r.toolName,
        allowed: 0,
        blocked: 0,
        latencies: [],
        reasonCounts: new Map(),
      }
      byToolMap.set(r.toolName, agg)
    }
    if (r.decision === 'allowed') agg.allowed++
    else if (r.decision === 'blocked') agg.blocked++
    agg.latencies.push(r.latencyMs)

    if (r.decision === 'blocked') {
      const reasonKey = r.reason ?? '(no reason)'
      agg.reasonCounts.set(reasonKey, (agg.reasonCounts.get(reasonKey) ?? 0) + 1)

      if (recentBlocked.length < 20) {
        recentBlocked.push({
          id: r.id,
          agentId: r.agentId,
          toolName: r.toolName,
          reason: reasonKey,
          createdAt: r.createdAt.toISOString(),
        })
      }
    }
  }

  const sortedLatencies = [...latencies].sort((a, b) => a - b)
  const p50LatencyMs = percentile(sortedLatencies, 0.5)
  const p95LatencyMs = percentile(sortedLatencies, 0.95)

  const byTool = Array.from(byToolMap.values()).map(agg => {
    const sorted = [...agg.latencies].sort((a, b) => a - b)
    const topBlockReasons = Array.from(agg.reasonCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
    return {
      toolName: agg.toolName,
      allowed: agg.allowed,
      blocked: agg.blocked,
      p50LatencyMs: percentile(sorted, 0.5),
      topBlockReasons,
    }
  })
  // Surface the tools causing the most blocks first — that's what an
  // operator scanning this dashboard is looking for.
  byTool.sort((a, b) => b.blocked - a.blocked || b.allowed - a.allowed)

  return NextResponse.json({
    windowDays,
    totalChecks: rows.length,
    allowed,
    blocked,
    p50LatencyMs,
    p95LatencyMs,
    totalInputTokens,
    totalOutputTokens,
    byTool,
    recentBlocked,
  })
}
