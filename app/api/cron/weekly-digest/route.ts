import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildWorkspaceDigest } from '@/lib/digest-builder'
import { sendDigestEmail } from '@/lib/digest-email'

/**
 * Weekly digest cron — runs Mondays 13:00 UTC.
 *
 * Walks every workspace, builds the digest payload, and emails each
 * opted-in member whose User has an email. Skips:
 *   - workspaces with zero agent activity in the window
 *   - members who toggled `digestOptIn` off
 *   - members already sent within the last 6 days (idempotency guard)
 *
 * Auth: header `Authorization: Bearer ${CRON_SECRET}` — same pattern as
 * /api/cron/follow-ups.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)

  const workspaces = await db.workspace.findMany({
    select: { id: true, name: true },
  })

  let workspacesProcessed = 0
  let workspacesSkippedNoActivity = 0
  let emailsSent = 0
  let emailsFailed = 0
  let membersSkippedOptOut = 0
  let membersSkippedRecentSend = 0

  for (const ws of workspaces) {
    let payload
    try {
      payload = await buildWorkspaceDigest(ws.id)
    } catch (err: any) {
      console.warn(`[WeeklyDigest] build failed for ${ws.id}:`, err.message)
      continue
    }
    if (payload.totals.messages === 0) {
      workspacesSkippedNoActivity++
      continue
    }
    workspacesProcessed++

    // Use explicit `select` so a pending digestOptIn / lastDigestSentAt
    // migration doesn't poison this query — Prisma's default-select-all
    // will throw when a schema column is missing in the DB.
    let members: Array<{
      id: string
      digestOptIn: boolean
      lastDigestSentAt: Date | null
      user: { id: string; email: string | null; name: string | null } | null
    }> = []
    try {
      members = await db.workspaceMember.findMany({
        where: { workspaceId: ws.id },
        select: {
          id: true,
          digestOptIn: true,
          lastDigestSentAt: true,
          user: { select: { id: true, email: true, name: true } },
        },
      })
    } catch (err: any) {
      if (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')) {
        console.warn('[WeeklyDigest] digest columns missing — run manual_weekly_digest_email.sql. Skipping.')
        continue
      }
      throw err
    }

    for (const m of members) {
      if (m.digestOptIn === false) { membersSkippedOptOut++; continue }
      if (m.lastDigestSentAt && new Date(m.lastDigestSentAt) > sixDaysAgo) { membersSkippedRecentSend++; continue }
      if (!m.user?.email) continue

      try {
        const result = await sendDigestEmail({
          to: m.user.email,
          recipientName: m.user.name,
          workspaceId: ws.id,
          workspaceName: ws.name || 'your workspace',
          payload,
        })
        if (result.ok) {
          emailsSent++
          await db.workspaceMember.update({
            where: { id: m.id },
            data: { lastDigestSentAt: new Date() },
          }).catch(() => { /* tolerate missing column on first deploy */ })
        } else {
          emailsFailed++
          console.warn(`[WeeklyDigest] send failed for ${m.user.email}: ${result.reason}`)
        }
      } catch (err: any) {
        emailsFailed++
        console.warn(`[WeeklyDigest] send error for ${m.user.email}:`, err.message)
      }
    }
  }

  return NextResponse.json({
    workspacesProcessed,
    workspacesSkippedNoActivity,
    emailsSent,
    emailsFailed,
    membersSkippedOptOut,
    membersSkippedRecentSend,
  })
}
