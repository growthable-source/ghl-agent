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

  // ── Time-based operator escalation ──
  // A conversation assigned to a human, where the visitor's message is the
  // last one and the operator hasn't replied within escalateAfterMinutes,
  // gets escalated: ping the assigned operator, and (if escalateReassign)
  // return it to the queue so another available operator picks it up.
  // Opt-in per workspace (escalateAfterMinutes > 0). The whole block is
  // guarded so a pre-migration DB (missing columns) simply skips it.
  let escalated = 0
  let reassigned = 0
  try {
    const escSettings = await db.liveChatSettings.findMany({
      where: { escalateAfterMinutes: { gt: 0 } },
      select: { workspaceId: true, escalateAfterMinutes: true, escalateReassign: true },
    })
    for (const s of escSettings) {
      const threshold = new Date(Date.now() - s.escalateAfterMinutes * 60 * 1000)
      const rows = await db.widgetConversation.findMany({
        where: {
          widget: { workspaceId: s.workspaceId },
          assignedUserId: { not: null },
          status: { not: 'ended' },
          escalatedNotifiedAt: null,
          lastMessageAt: { lt: threshold },
        },
        include: {
          widget: { select: { name: true, workspaceId: true } },
          assignedUser: { select: { id: true, name: true, email: true } },
        },
        take: 50,
      })
      for (const convo of rows) {
        const last = await db.widgetMessage.findFirst({
          where: { conversationId: convo.id },
          orderBy: { createdAt: 'desc' },
          select: { role: true, content: true },
        })
        // Only chase when the visitor is the one waiting. If the operator
        // already replied last, there's nothing stalled.
        if (!last || last.role !== 'visitor') continue

        const link = resolveHandoverLink({
          workspaceId: convo.widget.workspaceId,
          locationId: `widget:${convo.widgetId}`,
          conversationId: convo.id,
          channel: 'Live_Chat',
        })
        const who = convo.assignedUser?.name || convo.assignedUser?.email || 'the assigned operator'
        const preview = (last.content || '').length > 120 ? last.content.slice(0, 117) + '…' : last.content

        try {
          // Ping the assigned operator directly.
          if (convo.assignedUserId) {
            await notify({
              workspaceId: convo.widget.workspaceId,
              event: 'conversation.escalated',
              title: `A visitor has been waiting ${s.escalateAfterMinutes}+ min for your reply`,
              body: `On ${convo.widget.name || 'your widget'}. Last message: "${preview}"`,
              link,
              severity: 'warning',
              targetUserId: convo.assignedUserId,
            })
          }
          // When reassignment is on, return the chat to the queue and let
          // the router hand it to another available operator.
          if (s.escalateReassign) {
            await db.widgetConversation.update({
              where: { id: convo.id },
              data: { assignedUserId: null, assignedAt: null, assignmentReason: null, queuedAt: new Date() },
            })
            const { advanceQueue } = await import('@/lib/widget-routing')
            const res = await advanceQueue(convo.widget.workspaceId).catch(() => ({ assigned: 0 }))
            reassigned += res.assigned
            await notify({
              workspaceId: convo.widget.workspaceId,
              event: 'conversation.escalated',
              title: `Reassigned a stalled chat (waiting ${s.escalateAfterMinutes}+ min)`,
              body: `${who} hadn't replied — returned to the queue. Last message: "${preview}"`,
              link,
              severity: 'warning',
            })
          }
          escalated++
        } catch (err: any) {
          console.warn('[stale-cron] escalation failed for', convo.id, err?.message)
        }
        // Debounce regardless of outcome — cleared when the visitor or the
        // operator sends the next message.
        await db.widgetConversation.update({
          where: { id: convo.id }, data: { escalatedNotifiedAt: new Date() },
        }).catch(() => {})
      }
    }
  } catch (err: any) {
    console.warn('[stale-cron] escalation scan skipped:', err?.message)
  }

  // Queue backstop: the event-driven advance (chat-end / agent-online)
  // covers the common case; this re-evaluates any workspace with chats
  // still waiting, so nothing stalls in the queue if an event was missed.
  let queueAdvanced = 0
  try {
    const queuedRows = await db.widgetConversation.findMany({
      where: { queuedAt: { not: null }, assignedUserId: null, status: { not: 'ended' } },
      select: { widget: { select: { workspaceId: true } } },
      take: 500,
    })
    const workspaceIds = Array.from(new Set(queuedRows.map(r => r.widget?.workspaceId).filter(Boolean) as string[]))
    if (workspaceIds.length > 0) {
      const { advanceQueue } = await import('@/lib/widget-routing')
      for (const wsId of workspaceIds) {
        try {
          const res = await advanceQueue(wsId)
          queueAdvanced += res.assigned
        } catch (err: any) {
          console.warn('[stale-cron] advanceQueue failed for', wsId, err?.message)
        }
      }
    }
  } catch (err: any) {
    console.warn('[stale-cron] queue backstop failed:', err?.message)
  }

  await recordCronRun('stale-conversations', true)
  return NextResponse.json({ scanned: candidates.length, paged, checkedIn, escalated, reassigned, queueAdvanced })
}
