import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { notify } from '@/lib/notifications'
import { resolveHandoverLink } from '@/lib/handover-link'

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
// 10 minutes keeps the signal strong without pinging people over normal
// conversational pauses.
const STALE_MINUTES = 10

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
  for (const convo of candidates) {
    // Only fire when the LAST message is from the visitor — if the agent
    // replied last, quietness means they're waiting on the visitor which
    // isn't an attention-worthy signal.
    const last = await db.widgetMessage.findFirst({
      where: { conversationId: convo.id },
      orderBy: { createdAt: 'desc' },
      select: { role: true, content: true },
    })
    if (!last || last.role !== 'visitor') {
      // Still stamp to avoid re-checking every tick. Cleared when visitor replies.
      await db.widgetConversation.update({
        where: { id: convo.id }, data: { staleNotifiedAt: new Date() },
      }).catch(() => {})
      continue
    }

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
        title: `Chat on ${convo.widget.name || 'your widget'} has gone quiet`,
        body: `Visitor's last message: "${preview}" — no reply for ${STALE_MINUTES}+ minutes`,
        link,
        severity: 'warning',
      })
      paged++
    } catch (err: any) {
      console.warn('[stale-cron] notify failed for', convo.id, err?.message)
    }

    // Always stamp — success or failure — so we don't re-attempt forever.
    await db.widgetConversation.update({
      where: { id: convo.id }, data: { staleNotifiedAt: new Date() },
    }).catch(() => {})
  }

  return NextResponse.json({ scanned: candidates.length, paged })
}
