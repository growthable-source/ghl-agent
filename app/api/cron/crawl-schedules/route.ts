import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { crawlAndIndex, nextRunAt } from '@/lib/crawler'

/**
 * GET /api/cron/crawl-schedules
 *
 * Vercel cron hits this endpoint; it finds all active CrawlSchedules whose
 * nextRunAt is in the past and runs them. Each schedule uses incremental
 * crawling (skipUnchanged=true) so unchanged pages add 0 chunks.
 *
 * Protected with CRON_SECRET via the standard Vercel header.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || ''
  const expected = process.env.CRON_SECRET
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let due: Array<{ id: string; agentId: string; url: string; frequency: string }> = []
  try {
    due = await db.crawlSchedule.findMany({
      where: { isActive: true, nextRunAt: { lte: new Date() } },
      select: { id: true, agentId: true, url: true, frequency: true },
      take: 50,
    })
  } catch {
    return NextResponse.json({ ran: 0, reason: 'CrawlSchedule table not present' })
  }

  let ran = 0
  let totalNew = 0
  const results: Array<{ id: string; status: string; added?: number }> = []

  for (const schedule of due) {
    try {
      const { chunksAdded } = await crawlAndIndex({
        agentId: schedule.agentId,
        url: schedule.url,
        source: 'crawl',
        skipUnchanged: true,
      })
      await db.crawlSchedule.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: new Date(),
          lastStatus: chunksAdded > 0 ? 'success' : 'no_changes',
          lastError: null,
          newChunks: { increment: chunksAdded },
          nextRunAt: nextRunAt(schedule.frequency as any),
        },
      })
      totalNew += chunksAdded
      ran++
      results.push({ id: schedule.id, status: chunksAdded > 0 ? 'success' : 'no_changes', added: chunksAdded })

      // Fire webhook for agent knowledge updated
      if (chunksAdded > 0) {
        try {
          const agent = await db.agent.findUnique({
            where: { id: schedule.agentId },
            select: { workspaceId: true },
          })
          if (agent?.workspaceId) {
            const { fireWebhook } = await import('@/lib/webhooks')
            fireWebhook({
              workspaceId: agent.workspaceId,
              event: 'knowledge.updated',
              payload: { agentId: schedule.agentId, url: schedule.url, chunksAdded },
            }).catch(() => {})
          }
        } catch {}
      }
    } catch (err: any) {
      await db.crawlSchedule.update({
        where: { id: schedule.id },
        data: {
          lastRunAt: new Date(),
          lastStatus: 'failed',
          lastError: err.message?.slice(0, 500),
          nextRunAt: nextRunAt(schedule.frequency as any),
        },
      })
      results.push({ id: schedule.id, status: 'failed' })
    }
  }

  return NextResponse.json({ ran, due: due.length, totalNew, results })
}
