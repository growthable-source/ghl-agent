import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isMissingColumn } from '@/lib/migration-error'
import { getLiveChatSettings, AUTO_AWAY_MIN_MINUTES } from '@/lib/livechat-settings'
import { recordCronRun } from '@/lib/cron-heartbeat'

/**
 * GET /api/cron/auto-away — runs every 5 minutes (vercel.json).
 *
 * Flips Available members to Away when they've gone quiet: no dashboard
 * heartbeat (real pointer/keyboard input) for longer than the workspace's
 * autoAwayMinutes. This is what keeps routing honest — the Available pill
 * defaults to on and off-shift agents forget to toggle it, so round-robin
 * was landing chats on people who'd gone home.
 *
 * Deliberate properties:
 *  - Members the heartbeat has NEVER seen (lastActivityAt null) are
 *    exempt — rollout flips nobody until each member is first seen
 *    active. Kiosk synthetic users and email-only operators therefore
 *    keep their manual behavior.
 *  - Flips are stamped presenceSource='system', which is the ONLY state
 *    the heartbeat auto-restores from. Manual Away survives activity.
 *  - Chats already assigned to a flipped member stay assigned (same
 *    semantics as toggling yourself Away); the escalation cron handles
 *    stalled assigned chats.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Coarse pre-filter at the global minimum threshold; the exact
  // per-workspace cutoff is applied after settings load.
  const coarseCutoff = new Date(Date.now() - AUTO_AWAY_MIN_MINUTES * 60_000)

  let candidates: Array<{ id: string; workspaceId: string; lastActivityAt: Date | null }> = []
  try {
    candidates = await db.workspaceMember.findMany({
      where: {
        isAvailable: true,
        lastActivityAt: { not: null, lt: coarseCutoff },
      } as any,
      select: { id: true, workspaceId: true, lastActivityAt: true } as any,
      take: 500, // bounded per tick; stragglers catch the next run
    }) as any
  } catch (err) {
    if (isMissingColumn(err)) {
      await recordCronRun('auto-away', true, 'migration pending — skipped')
      return NextResponse.json({ skipped: 'migration pending' })
    }
    await recordCronRun('auto-away', false, err instanceof Error ? err.message : String(err))
    throw err
  }

  // Group by workspace so settings load once per workspace involved.
  const byWorkspace = new Map<string, typeof candidates>()
  for (const c of candidates) {
    const list = byWorkspace.get(c.workspaceId) ?? []
    list.push(c)
    byWorkspace.set(c.workspaceId, list)
  }

  let flipped = 0
  for (const [workspaceId, members] of byWorkspace) {
    const settings = await getLiveChatSettings(workspaceId)
    if (!settings.autoAwayEnabled) continue
    const cutoff = new Date(Date.now() - settings.autoAwayMinutes * 60_000)

    for (const m of members) {
      if (!m.lastActivityAt || m.lastActivityAt >= cutoff) continue
      // Guarded write: only flip if still Available AND still idle — a
      // heartbeat between our read and this write wins.
      const res = await db.workspaceMember.updateMany({
        where: {
          id: m.id,
          isAvailable: true,
          lastActivityAt: { lt: cutoff },
        } as any,
        data: {
          isAvailable: false,
          availabilityChangedAt: new Date(),
          presenceSource: 'system',
        } as any,
      }).catch(() => ({ count: 0 }))
      if (res.count === 0) continue
      flipped++
      // Timeline event — best-effort, table may predate this feature.
      try {
        await (db as any).memberPresenceEvent.create({
          data: { memberId: m.id, workspaceId, state: 'away', source: 'system' },
        })
      } catch { /* timeline only */ }
    }
  }

  await recordCronRun('auto-away', true)
  return NextResponse.json({ checked: candidates.length, flipped })
}
