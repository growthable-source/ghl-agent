import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { isMissingColumn } from '@/lib/migration-error'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:workspaceId/csat?days=30
 *
 * Aggregate visitor satisfaction across every widget conversation in
 * the workspace. The widget surfaces a 1–5 star prompt when a chat
 * closes (operator marks resolved, or visitor chooses "Rate this
 * chat") and writes to WidgetConversation.csatRating. This endpoint
 * stitches those scattered ratings into the numbers an operator/owner
 * actually cares about: overall average, recent comments, per-agent
 * breakdown.
 *
 * Filters everything to the last `days` days (default 30) — older
 * scores tend to mislead because the agent's prompts and tools have
 * usually been tuned since.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const days = Math.max(1, Math.min(180, Number(url.searchParams.get('days')) || 30))
  const since = new Date(Date.now() - days * 86_400_000)

  try {
    // All widgets in this workspace — we filter conversations by
    // widgetId rather than walking through ChatWidget → conversations
    // because Prisma's relation count + groupBy on related tables is
    // finicky and the workspace usually has few widgets.
    const widgets = await db.chatWidget.findMany({
      where: { workspaceId },
      select: { id: true, name: true },
    })
    const widgetIds = widgets.map(w => w.id)
    if (widgetIds.length === 0) {
      return NextResponse.json(empty())
    }

    const ratedConvos = await db.widgetConversation.findMany({
      where: {
        widgetId: { in: widgetIds },
        csatRating: { not: null },
        csatSubmittedAt: { gte: since },
      },
      select: {
        id: true,
        widgetId: true,
        agentId: true,
        csatRating: true,
        csatComment: true,
        csatSubmittedAt: true,
        visitor: { select: { name: true, email: true } },
      },
      orderBy: { csatSubmittedAt: 'desc' },
      take: 500,
    })

    // We also pull the total *closed* conversations in the window so
    // operators see a response-rate context line: "37 of 124 closed
    // chats rated (30%)." Without that anchor, a single 5★ rating
    // looks like a perfect score.
    const closedTotal = await db.widgetConversation.count({
      where: {
        widgetId: { in: widgetIds },
        status: 'ended',
        lastMessageAt: { gte: since },
      },
    })

    // Agent name lookup — one query for every unique agentId we
    // encountered, then merged into the response.
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
    const widgetNameById = new Map(widgets.map(w => [w.id, w.name]))

    const totalRated = ratedConvos.length
    const sumRatings = ratedConvos.reduce((acc, c) => acc + (c.csatRating ?? 0), 0)
    const avg = totalRated > 0 ? sumRatings / totalRated : 0

    // 1★ → 5★ histogram. The widget enforces 1–5 server-side so we
    // can safely index without bounds checks.
    const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    for (const c of ratedConvos) {
      const r = c.csatRating as 1 | 2 | 3 | 4 | 5
      if (r >= 1 && r <= 5) distribution[r] += 1
    }

    // Per-agent rollup. Unassigned conversations bucket under
    // "(no agent)" so we don't drop them — usually means a widget
    // without defaultAgentId (rare but possible).
    type AgentRow = { agentId: string | null; name: string; count: number; sum: number; avg: number }
    const byAgentMap = new Map<string, AgentRow>()
    for (const c of ratedConvos) {
      const key = c.agentId ?? '∅'
      const name = c.agentId ? (agentNameById.get(c.agentId) || 'Agent') : '(no agent)'
      const existing = byAgentMap.get(key)
      if (existing) {
        existing.count += 1
        existing.sum += c.csatRating ?? 0
        existing.avg = existing.sum / existing.count
      } else {
        byAgentMap.set(key, {
          agentId: c.agentId,
          name,
          count: 1,
          sum: c.csatRating ?? 0,
          avg: c.csatRating ?? 0,
        })
      }
    }
    const byAgent = Array.from(byAgentMap.values()).sort((a, b) => b.count - a.count)

    // Recent 30 — operators want to read comments and click through
    // to the original conversation. Capped well below `take: 500`
    // above so payloads stay light.
    const recent = ratedConvos.slice(0, 30).map(c => ({
      conversationId: c.id,
      widgetId: c.widgetId,
      widgetName: widgetNameById.get(c.widgetId) || 'Widget',
      agentId: c.agentId,
      agentName: c.agentId ? (agentNameById.get(c.agentId) || 'Agent') : null,
      rating: c.csatRating,
      comment: c.csatComment,
      submittedAt: c.csatSubmittedAt?.toISOString() ?? null,
      visitorLabel: c.visitor?.name || c.visitor?.email || 'Anonymous visitor',
    }))

    return NextResponse.json({
      days,
      totalRated,
      closedTotal,
      responseRate: closedTotal > 0 ? totalRated / closedTotal : 0,
      averageRating: Number(avg.toFixed(2)),
      distribution,
      byAgent,
      recent,
    })
  } catch (err: any) {
    if (isMissingColumn(err)) {
      return NextResponse.json({
        ...empty(),
        notMigrated: true,
        error: "CSAT columns aren't migrated yet. Run prisma/migrations-legacy/manual_widget_csat.sql.",
      })
    }
    return NextResponse.json({ error: err.message || 'Failed to load CSAT' }, { status: 500 })
  }
}

function empty() {
  return {
    days: 30,
    totalRated: 0,
    closedTotal: 0,
    responseRate: 0,
    averageRating: 0,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    byAgent: [],
    recent: [],
  }
}
