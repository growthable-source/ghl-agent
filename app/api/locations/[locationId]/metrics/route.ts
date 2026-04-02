import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ locationId: string }> }
) {
  const { locationId } = await params

  const [total, success, skipped, tokenSum, recentLogs] = await Promise.all([
    db.messageLog.count({ where: { locationId } }),
    db.messageLog.count({ where: { locationId, status: 'SUCCESS' } }),
    db.messageLog.count({ where: { locationId, status: 'SKIPPED' } }),
    db.messageLog.aggregate({ where: { locationId }, _sum: { tokensUsed: true } }),
    db.messageLog.findMany({
      where: { locationId },
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
