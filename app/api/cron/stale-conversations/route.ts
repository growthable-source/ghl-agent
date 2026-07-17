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
 * than STALE_MINUTES ago and the thread hasn't already been flagged. For a
 * bounded number per tick, first RE-RUNS the AI agent on the unanswered
 * message — under burst load the original run can die without a trace
 * (pool starvation, function kill), and nothing else ever retries, which
 * is how "10 chats waiting, AI answers 4-5" happens. Only when recovery
 * doesn't produce a reply do we page a human via `conversation.stale`.
 *
 * Debounce: each flagged thread gets `staleNotifiedAt` stamped so we don't
 * re-page (or re-run the agent) every cron tick. The widget message route
 * clears that stamp the moment a visitor sends another message, which lets
 * the thread go stale again if the visitor comes back and the agent goes
 * quiet a second time.
 *
 * Runs on the Vercel cron configured in vercel.json.
 */

// The AI-recovery runs below are full agent runs (LLM + tools) — allow the
// function to see them through rather than dying at the platform default.
export const maxDuration = 300

// Tunable — a thread is "stale" if no one has said anything for this long.
// 3 minutes: short enough to catch live-chat visitors who got distracted
// before they close the tab, long enough that we don't nudge during a
// natural typing pause. The cron schedule (vercel.json) runs every
// minute so the effective response window is 3–4 minutes.
const STALE_MINUTES = 3

// How many unanswered chats get an AI re-run per tick. Each is a full agent
// run competing for the instance's small PG pool, so keep this modest — the
// cron fires every minute, so throughput is still 3/min sustained.
//
// Overlap safety: runAgent's wall-clock budget (AGENT_WALL_CLOCK_BUDGET_MS,
// default 150s) is deliberately shorter than STALE_MINUTES, so by the time a
// chat qualifies here its original run is guaranteed dead — a recovery run
// can't race a still-alive original and double-reply.
const MAX_AI_RECOVERIES = 3

/** Page the inbox crew about a visitor left waiting. Shared by the direct
 *  path (recovery slots exhausted) and the post-recovery-failure path. */
async function pageStaleOperator(
  convo: { id: string; widgetId: string; widget: { name: string | null; workspaceId: string } },
  preview: string,
) {
  const link = resolveHandoverLink({
    workspaceId: convo.widget.workspaceId,
    locationId: `widget:${convo.widgetId}`,
    conversationId: convo.id,
    channel: 'Live_Chat',
  })
  await notify({
    workspaceId: convo.widget.workspaceId,
    event: 'conversation.stale',
    title: `Agent on ${convo.widget.name || 'your widget'} hasn't replied in ${STALE_MINUTES}+ minutes`,
    body: `Visitor is waiting. Last message: "${preview}"`,
    link,
    severity: 'warning',
  })
}

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
  // Full widget + visitor rows come along because the AI-recovery path
  // below feeds candidates straight into runWidgetAgent, which expects the
  // same shape the widget message route loads.
  const candidates = await db.widgetConversation.findMany({
    where: {
      status: 'active',
      lastMessageAt: { lt: staleBefore },
      staleNotifiedAt: null,
    },
    include: { widget: true, visitor: true },
    take: 50,   // bounded per-tick to avoid thundering-herd on restart
  })

  let paged = 0
  let checkedIn = 0
  const recoveries: Array<{ convo: (typeof candidates)[number]; content: string; preview: string }> = []
  for (const convo of candidates) {
    const last = await db.widgetMessage.findFirst({
      where: { conversationId: convo.id },
      orderBy: { createdAt: 'desc' },
      select: { role: true, content: true, kind: true },
    })

    // Branch A — visitor sent last, agent hasn't replied. The conversation
    // is status='active', i.e. the AI owns it — so an unanswered visitor
    // message here means the original agent run died (burst-load pool
    // starvation, function kill, …). Queue a bounded number for an AI
    // re-run; overflow gets paged to a human straight away, same as before.
    if (last && last.role === 'visitor') {
      const preview = (last.content || '').length > 120
        ? last.content.slice(0, 117) + '…'
        : last.content
      // Uploads store a URL/JSON blob as content — hand the agent the same
      // breadcrumb the upload route would have.
      const content = last.kind === 'image' ? '(visitor sent an image)'
        : last.kind === 'file' ? '(visitor sent a file)'
        : (last.content || '(visitor message)')
      if (recoveries.length < MAX_AI_RECOVERIES) {
        recoveries.push({ convo, content, preview })
      } else {
        try {
          await pageStaleOperator(convo, preview)
          paged++
        } catch (err: any) {
          console.warn('[stale-cron] notify failed for', convo.id, err?.message)
        }
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

  // ── AI recovery backstop ──
  // Re-run the agent on unanswered chats (bounded, concurrent — each run is
  // mostly waiting on the LLM). runWidgetAgent re-checks eligibility itself
  // (brand AI toggle, pause state, handed-off status), so an ineligible chat
  // falls through to the operator page below instead of double-replying.
  // Success test is simply "is the newest message now from the agent" —
  // that covers both a real reply and the runner's own fallback line.
  let recovered = 0
  if (recoveries.length > 0) {
    const { runWidgetAgent } = await import('@/lib/widget-agent-runner')
    await Promise.allSettled(recoveries.map(async ({ convo, content, preview }) => {
      try {
        await runWidgetAgent({ convo, content })
      } catch (err: any) {
        console.warn('[stale-cron] AI recovery run failed for', convo.id, err?.message)
      }
      const newest = await db.widgetMessage.findFirst({
        where: { conversationId: convo.id },
        orderBy: { createdAt: 'desc' },
        select: { role: true },
      }).catch(() => null)
      if (newest?.role === 'agent') {
        recovered++
        return
      }
      try {
        await pageStaleOperator(convo, preview)
        paged++
      } catch (err: any) {
        console.warn('[stale-cron] notify failed for', convo.id, err?.message)
      }
    }))
  }

  await recordCronRun('stale-conversations', true)
  return NextResponse.json({ scanned: candidates.length, paged, checkedIn, recovered, escalated, reassigned, queueAdvanced })
}
