import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * Daily sweep of expired/aged workspace invites.
 *
 * We keep accepted invites forever (audit trail) and only sweep the
 * pending ones whose expiry has elapsed. A small grace window after
 * expiry (3 days) lets operators see a "this invite has expired"
 * state in the UI before the row vanishes — without that, a resend
 * race could surprise the operator with a "not found" error mid-flow.
 *
 * Aggressive cap on the delete count per run so a buggy invite-spam
 * doesn't burst into a giant transaction. Re-runs catch the rest.
 */

const GRACE_DAYS = 3
const MAX_PER_RUN = 1000

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000)

  // Find expired pending invites — we DON'T delete accepted ones.
  const stale = await db.workspaceInvite.findMany({
    where: {
      acceptedAt: null,
      expiresAt: { lt: cutoff },
    },
    select: { id: true },
    take: MAX_PER_RUN,
  })
  let invitesDeleted = 0
  if (stale.length > 0) {
    const ids = stale.map(i => i.id)
    const res = await db.workspaceInvite.deleteMany({ where: { id: { in: ids } } })
    invitesDeleted = res.count
  }

  // Also sweep used/expired visitor recovery tokens — they're
  // single-use 30-min magic links, so anything older than the
  // grace window is safe to delete. Best-effort: missing table
  // (pre-migration) silently skips.
  let recoveryDeleted = 0
  try {
    const old = new Date(Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000)
    const res = await (db as any).visitorRecoveryToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: old } },
          { usedAt: { not: null, lt: old } },
        ],
      },
    })
    recoveryDeleted = res.count
  } catch { /* table missing — skip */ }

  return NextResponse.json({
    invitesDeleted,
    recoveryDeleted,
  })
}
