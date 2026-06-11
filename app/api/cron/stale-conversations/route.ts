import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { notify } from '@/lib/notifications'
import { resolveHandoverLink } from '@/lib/handover-link'
import { sendQuietCheckIn } from '@/lib/widget-check-in'
import { recordCronRun } from '@/lib/cron-heartbeat'

/**
 * GET /api/cron/stale-conversations
 *
 * Finds widget conversations where the visitor sent the last message more
 * than STALE_MINUTES ago and the thread hasn't already been flagged. Fires
 * a `conversation.stale` event with a deep link to the inbox so whoever
 * monitors handover can jump in.
 *
 * Debounce: each flagged thread gets `staleNotifiedAt` stamped so we don't
 * re-page every cron tick. The widget message route clears that stamp the
 * moment a visitor sends another message, which lets the thread go stale
 * again if the visitor comes back and the agent goes quiet a second time.
 *
 * Runs on the Vercel cron configured in vercel.json.
 */

// Tunable — a thread is "stale" if no one has said anything for this long.
// 3 minutes: short enough to catch live-chat visitors who got distracted
// before they close the tab, long enough that we don't nudge during a
// natural typing pause. The cron schedule (vercel.json) runs every
// minute so the effective response window is 3–4 minutes.
const STALE_MINUTES = 3

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const staleBefore = new Date(Date.now() - STALE_MINUTES * 60 * 1000)

  // Candidate conversations: status=active, lastMessageAt older than the
  // threshold, and not already flagged. Widget join pulled in so we have
  // workspaceId + name for the notification body.
  const candidates = await db.widgetConversation.findMany({
    where: {
      status: 'active',
      lastMessageAt: { lt: staleBefore },
      staleNotifiedAt: null,
    },
    include: { widget: { select: { name: true, workspaceId: true } } },
    take: 50,   // bounded per-tick to avoid thundering-herd on restart
  })

  let paged = 0
  let checkedIn = 0
  for (const convo of candidates) {
    const last = await db.widgetMessage.findFirst({
      where: { conversationId: convo.id },
      orderBy: { createdAt: 'desc' },
      select: { role: true, content: true },
    })

    // Branch A — visitor sent last, agent hasn't replied. Notify the
    // operator so they can step in. Same behaviour as before.
    if (last && last.role === 'visitor') {
      try {
        const link = resolveHandoverLink({
          workspaceId: convo.widget.workspaceId,
          locationId: `widget:${convo.widgetId}`,
          conversationId: convo.id,
          channel: 'Live_Chat',
        })
        const preview = (last.content || '').length > 120
          ? last.content.slice(0, 117) + '…'
          : last.content
        await notify({
          workspaceId: convo.widget.workspaceId,
          event: 'conversation.stale',
          title: `Agent on ${convo.widget.name || 'your widget'} hasn't replied in ${STALE_MINUTES}+ minutes`,
          body: `Visitor is waiting. Last message: "${preview}"`,
          link,
          severity: 'warning',
        })
        paged++
      } catch (err: any) {
        console.warn('[stale-cron] notify failed for', convo.id, err?.message)
      }
    }
    // Branch B — agent sent last, visitor went quiet. Send a brief
    // in-voice "still there?" check-in so visitors don't silently
    // abandon. Helper runs Claude Haiku, persists the message, and
    // broadcasts via SSE. No-op if the agent already nudged.
    else if (last && last.role === 'agent') {
      try {
        const result = await sendQuietCheckIn(convo.id)
        if (result.sent) checkedIn++
      } catch (err: any) {
        console.warn('[stale-cron] check-in failed for', convo.id, err?.message)
      }
    }

    // Always stamp — success or failure — so we don't re-attempt forever.
    // Cleared the moment the visitor sends another message (see
    // app/api/widget/[widgetId]/conversations/[conversationId]/messages
    // POST), so a re-engaged thread that goes quiet AGAIN can fire a
    // second check-in later.
    await db.widgetConversation.update({
      where: { id: convo.id }, data: { staleNotifiedAt: new Date() },
    }).catch(() => {})
  }

  await recordCronRun('stale-conversations', true)
  return NextResponse.json({ scanned: candidates.length, paged, checkedIn })
}
