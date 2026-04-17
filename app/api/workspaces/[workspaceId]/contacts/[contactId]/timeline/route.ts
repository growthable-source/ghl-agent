import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; contactId: string }> }

/**
 * GET /api/workspaces/:workspaceId/contacts/:contactId/timeline
 *
 * Unified timeline for one contact — every channel, every agent, every action.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, contactId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  const locationIds = locations.map(l => l.id)
  if (locationIds.length === 0) {
    return NextResponse.json({ events: [], summary: {} })
  }

  // Pull everything related to this contact across workspace locations
  const [messages, convoMessages, followUps, states, memories] = await Promise.all([
    db.messageLog.findMany({
      where: { contactId, locationId: { in: locationIds } },
      include: { agent: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    db.conversationMessage.findMany({
      where: { contactId, locationId: { in: locationIds } },
      include: { agent: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    db.followUpJob.findMany({
      where: { contactId, locationId: { in: locationIds } },
      include: { sequence: { select: { name: true, agent: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: 'asc' },
    }),
    db.conversationStateRecord.findMany({
      where: { contactId, locationId: { in: locationIds } },
      include: { agent: { select: { id: true, name: true } } },
    }),
    db.contactMemory.findMany({
      where: { contactId, locationId: { in: locationIds } },
      include: { agent: { select: { id: true, name: true } } },
    }),
  ])

  type TimelineEvent = {
    id: string
    at: string
    type: string
    agent: { id: string; name: string } | null
    label: string
    content?: string
    detail?: string
    meta?: Record<string, any>
  }

  const events: TimelineEvent[] = []

  // Conversation messages (inbound + outbound from agent)
  for (const m of convoMessages) {
    events.push({
      id: `conv-${m.id}`,
      at: m.createdAt.toISOString(),
      type: m.role === 'user' ? 'inbound' : 'outbound',
      agent: m.agent,
      label: m.role === 'user' ? 'Contact said' : 'Agent replied',
      content: m.content,
    })
  }

  // Tool calls from MessageLog
  for (const log of messages) {
    if (log.actionsPerformed?.length) {
      for (const action of log.actionsPerformed) {
        events.push({
          id: `tool-${log.id}-${action}`,
          at: log.createdAt.toISOString(),
          type: 'tool',
          agent: log.agent,
          label: `Used ${action.replace(/_/g, ' ')}`,
        })
      }
    }
    if (log.status === 'ERROR' && log.errorMessage) {
      events.push({
        id: `err-${log.id}`,
        at: log.createdAt.toISOString(),
        type: 'error',
        agent: log.agent,
        label: 'Error',
        content: log.errorMessage,
      })
    }
  }

  // Follow-ups
  for (const f of followUps) {
    events.push({
      id: `fu-sched-${f.id}`,
      at: f.createdAt.toISOString(),
      type: 'follow_up_scheduled',
      agent: f.sequence.agent,
      label: `Scheduled follow-up`,
      detail: f.sequence.name,
      meta: { channel: f.channel, scheduledFor: f.scheduledAt },
    })
    if (f.status === 'SENT' && f.lastSentAt) {
      events.push({
        id: `fu-sent-${f.id}`,
        at: f.lastSentAt.toISOString(),
        type: 'follow_up_sent',
        agent: f.sequence.agent,
        label: 'Follow-up sent',
        detail: f.sequence.name,
        meta: { channel: f.channel },
      })
    }
    if (f.status === 'CANCELLED' && f.cancelledAt) {
      events.push({
        id: `fu-cancel-${f.id}`,
        at: f.cancelledAt.toISOString(),
        type: 'follow_up_cancelled',
        agent: f.sequence.agent,
        label: 'Follow-up cancelled',
        detail: f.sequence.name,
      })
    }
  }

  // State transitions
  for (const s of states) {
    if (s.pausedAt) {
      events.push({
        id: `pause-${s.id}`,
        at: s.pausedAt.toISOString(),
        type: 'paused',
        agent: s.agent,
        label: 'Agent paused',
        content: s.pauseReason || 'Stop condition reached',
      })
    }
    if (s.resumedAt) {
      events.push({
        id: `resume-${s.id}`,
        at: s.resumedAt.toISOString(),
        type: 'resumed',
        agent: s.agent,
        label: 'Conversation resumed',
      })
    }
  }

  // Sort by time ascending (oldest first for timeline reading)
  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())

  // Compute summary
  const inboundCount = events.filter(e => e.type === 'inbound').length
  const outboundCount = events.filter(e => e.type === 'outbound').length
  const toolCount = events.filter(e => e.type === 'tool').length
  const followUpsSent = events.filter(e => e.type === 'follow_up_sent').length

  // Agents involved
  const agentsInvolved = Array.from(
    new Map(
      events.filter(e => e.agent).map(e => [e.agent!.id, e.agent!])
    ).values()
  )

  return NextResponse.json({
    events,
    summary: {
      totalEvents: events.length,
      inboundMessages: inboundCount,
      outboundMessages: outboundCount,
      toolCalls: toolCount,
      followUpsSent,
      agentsInvolved,
      firstContact: events[0]?.at ?? null,
      lastActivity: events[events.length - 1]?.at ?? null,
      memories: memories.map(m => ({
        agent: m.agent,
        summary: m.summary,
        updatedAt: m.updatedAt,
      })),
    },
  })
}
