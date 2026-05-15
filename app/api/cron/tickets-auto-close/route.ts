import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/cron/tickets-auto-close
 *
 * Daily sweep — for every workspace with TicketingSettings.enabled
 * AND autoCloseAfterDays > 0, close any open/pending ticket whose
 * lastInboundAt (or createdAt when no inbound yet) is older than
 * the threshold AND whose lastOutboundAt is more recent.
 *
 * "more recent outbound than inbound" — we close tickets where the
 * team replied and the customer never came back. We deliberately do
 * NOT auto-close tickets stuck waiting on the team; those need
 * human attention.
 *
 * Per-workspace fan-out is sequential — most workspaces process in
 * tens of milliseconds; if any one of them throws we keep going.
 */
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = req.headers.get('authorization')
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let settings: Array<{ workspaceId: string; autoCloseAfterDays: number }> = []
  try {
    settings = await (db as any).ticketingSettings.findMany({
      where: { enabled: true, autoCloseAfterDays: { gt: 0 } },
      select: { workspaceId: true, autoCloseAfterDays: true },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/relation .* does not exist/i.test(msg)) {
      return NextResponse.json({ skipped: 'migration_pending' })
    }
    throw err
  }

  const results: Array<{ workspaceId: string; closed: number }> = []
  const now = Date.now()

  for (const s of settings) {
    const cutoff = new Date(now - s.autoCloseAfterDays * 86_400_000)
    try {
      const stale = await db.ticket.findMany({
        where: {
          workspaceId: s.workspaceId,
          status: { in: ['open', 'pending'] },
          // Team's last reply must exist AND be older than the cutoff.
          // (If team never replied, the team owes the customer — don't
          // close.)
          lastOutboundAt: { lt: cutoff, not: null },
          // Customer hasn't replied since the team did. We compare
          // lastInboundAt < lastOutboundAt by selecting only tickets
          // where the inbound is older than the outbound (or null).
          OR: [
            { lastInboundAt: null },
            { lastInboundAt: { lt: cutoff } },
          ],
        },
        select: { id: true, lastInboundAt: true, lastOutboundAt: true },
        take: 500,
      })
      // Filter in JS: lastInboundAt < lastOutboundAt (or null)
      const ids = stale
        .filter(t => !t.lastInboundAt || (t.lastOutboundAt && t.lastInboundAt < t.lastOutboundAt))
        .map(t => t.id)
      if (ids.length > 0) {
        await db.ticket.updateMany({
          where: { id: { in: ids } },
          data: { status: 'closed', closedAt: new Date(), lastActivityAt: new Date() },
        })
      }
      results.push({ workspaceId: s.workspaceId, closed: ids.length })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn('[tickets-auto-close] workspace failed:', s.workspaceId, msg)
      results.push({ workspaceId: s.workspaceId, closed: 0 })
    }
  }

  return NextResponse.json({ workspaces: results.length, results })
}
