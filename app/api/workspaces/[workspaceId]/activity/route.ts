import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:workspaceId/activity
 *
 * Streaming-like feed of recent agent actions. Unifies:
 *   - MessageLog (replies sent)
 *   - FollowUpJob (scheduled/cancelled)
 *   - ConversationStateRecord transitions
 *
 * Query: ?since=<ISO timestamp> for incremental fetching
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const sinceParam = url.searchParams.get('since')
  const since = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 60 * 60 * 1000) // default last hour

  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  const locationIds = locations.map(l => l.id)
  if (locationIds.length === 0) return NextResponse.json({ events: [] })

  // Recent messages
  const messages = await db.messageLog.findMany({
    where: {
      locationId: { in: locationIds },
      createdAt: { gt: since },
    },
    include: { agent: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  // Recent follow-up job events
  const followUps = await db.followUpJob.findMany({
    where: {
      locationId: { in: locationIds },
      OR: [
        { createdAt: { gt: since } },
        { lastSentAt: { gt: since } },
        { cancelledAt: { gt: since } },
      ],
    },
    include: {
      sequence: { select: { name: true, agentId: true, agent: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  // Compose into unified event list
  type Event = {
    id: string
    type: string
    at: string
    agent: { id: string; name: string } | null
    contactId: string
    icon: string
    label: string
    detail?: string
    channel?: string
    status?: string
    conversationId?: string | null
  }

  const events: Event[] = []

  for (const m of messages) {
    events.push({
      id: `msg-${m.id}`,
      type: 'message',
      at: m.createdAt.toISOString(),
      agent: m.agent,
      contactId: m.contactId,
      icon: m.status === 'ERROR' ? '⚠' : '💬',
      label: m.status === 'ERROR' ? 'Error processing message' : 'Replied',
      detail: m.outboundReply?.slice(0, 100) || m.inboundMessage?.slice(0, 100),
      status: m.status,
      conversationId: m.conversationId,
    })
    // Surface tool calls as their own events
    if (m.actionsPerformed?.length) {
      for (const action of m.actionsPerformed) {
        events.push({
          id: `tool-${m.id}-${action}`,
          type: 'tool',
          at: m.createdAt.toISOString(),
          agent: m.agent,
          contactId: m.contactId,
          icon: '🔧',
          label: action.replace(/_/g, ' '),
          conversationId: m.conversationId,
        })
      }
    }
  }

  for (const f of followUps) {
    if (f.status === 'SENT' && f.lastSentAt && f.lastSentAt > since) {
      events.push({
        id: `fu-sent-${f.id}`,
        type: 'follow_up_sent',
        at: f.lastSentAt.toISOString(),
        agent: f.sequence.agent,
        contactId: f.contactId,
        icon: '📤',
        label: `Sent follow-up`,
        detail: f.sequence.name,
        channel: f.channel,
      })
    } else if (f.status === 'CANCELLED' && f.cancelledAt && f.cancelledAt > since) {
      events.push({
        id: `fu-cancel-${f.id}`,
        type: 'follow_up_cancelled',
        at: f.cancelledAt.toISOString(),
        agent: f.sequence.agent,
        contactId: f.contactId,
        icon: '⊘',
        label: `Cancelled follow-up`,
        detail: f.sequence.name,
      })
    } else if (f.createdAt > since) {
      events.push({
        id: `fu-new-${f.id}`,
        type: 'follow_up_scheduled',
        at: f.createdAt.toISOString(),
        agent: f.sequence.agent,
        contactId: f.contactId,
        icon: '⏱',
        label: `Scheduled follow-up`,
        detail: f.sequence.name,
        channel: f.channel,
      })
    }
  }

  // Sort newest first
  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

  return NextResponse.json({ events: events.slice(0, 200) })
}
