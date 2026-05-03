/**
 * Per-agent rollup stats. Used by the Activity Overview to render a
 * one-glance summary of recent runs without pulling full message log
 * rows (which can be tens of thousands per workspace).
 *
 * Returns counts for the last 7 / 30 days plus a small "last seen"
 * breakdown so the overview can show "12 today · 84 this week ·
 * 2 errors" without further round-trips.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  const since24h = new Date(now - day)
  const since7d  = new Date(now - 7 * day)
  const since30d = new Date(now - 30 * day)

  // Run the four counts in parallel — index on (agentId, createdAt)
  // makes each one cheap.
  const [count24h, count7d, count30d, errors7d, success7d, latest] = await Promise.all([
    db.messageLog.count({ where: { agentId, createdAt: { gte: since24h } } }),
    db.messageLog.count({ where: { agentId, createdAt: { gte: since7d } } }),
    db.messageLog.count({ where: { agentId, createdAt: { gte: since30d } } }),
    db.messageLog.count({ where: { agentId, createdAt: { gte: since7d }, status: 'ERROR' } }),
    db.messageLog.count({ where: { agentId, createdAt: { gte: since7d }, status: 'SUCCESS' } }),
    db.messageLog.findFirst({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, status: true, inboundMessage: true },
    }),
  ])

  const total7d = count7d
  // success rate is over the last 7 days, ignoring SKIPPED / PENDING since
  // those don't represent agent attempts. Only errors and successes count.
  const attempts7d = errors7d + success7d
  const successRate = attempts7d > 0 ? Math.round((success7d / attempts7d) * 100) : null

  return NextResponse.json({
    counts: { day: count24h, week: count7d, month: count30d },
    successRate,
    errors7d,
    success7d,
    total7d,
    latest: latest
      ? {
          at: latest.createdAt.toISOString(),
          status: latest.status,
          preview: (latest.inboundMessage ?? '').slice(0, 80),
        }
      : null,
  })
}
