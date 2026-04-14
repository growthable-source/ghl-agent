import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // Get all locationIds for this workspace
  const locations = await db.location.findMany({
    where: { workspaceId },
    select: { id: true },
  })
  const locationIds = locations.map(l => l.id)

  const whereClause = { locationId: { in: locationIds } }

  const [total, success, skipped, tokenSum, recentLogs] = await Promise.all([
    db.messageLog.count({ where: whereClause }),
    db.messageLog.count({ where: { ...whereClause, status: 'SUCCESS' } }),
    db.messageLog.count({ where: { ...whereClause, status: 'SKIPPED' } }),
    db.messageLog.aggregate({ where: whereClause, _sum: { tokensUsed: true } }),
    db.messageLog.findMany({
      where: whereClause,
      include: { agent: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ])

  return NextResponse.json({
    total,
    success,
    skipped,
    successRate: total > 0 ? Math.round((success / total) * 100) : 0,
    totalTokens: tokenSum._sum.tokensUsed ?? 0,
    recentLogs,
  })
}
