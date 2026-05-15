import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; ticketId: string }> }

const VALID_STATUSES = new Set(['open', 'pending', 'on_hold', 'resolved', 'closed'])
const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent'])

/**
 * GET   — ticket detail + full message thread.
 * PATCH — update status / priority / assignee. status transitions also
 *         stamp closedAt or reopenedAt and bump lastActivityAt.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, ticketId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, workspaceId },
    include: {
      assignedUser: { select: { id: true, name: true, email: true, image: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { sentByUser: { select: { id: true, name: true, email: true, image: true } } },
      },
      conversation: { select: { id: true, widgetId: true, widget: { select: { name: true } } } },
    },
  })
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })

  return NextResponse.json({ ticket })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, ticketId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const existing = await db.ticket.findFirst({
    where: { id: ticketId, workspaceId },
    select: { id: true, status: true },
  })
  if (!existing) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}
  const now = new Date()

  if (typeof body.status === 'string' && VALID_STATUSES.has(body.status)) {
    data.status = body.status
    // Terminal-state bookkeeping. Closing stamps closedAt; moving back
    // out of a terminal state stamps reopenedAt + clears closedAt so
    // reporting can show "this got reopened on X."
    const wasTerminal = existing.status === 'closed' || existing.status === 'resolved'
    const isTerminal = body.status === 'closed' || body.status === 'resolved'
    if (isTerminal && !wasTerminal) data.closedAt = now
    if (!isTerminal && wasTerminal) { data.reopenedAt = now; data.closedAt = null }
  }
  if (typeof body.priority === 'string' && VALID_PRIORITIES.has(body.priority)) {
    data.priority = body.priority
  }
  if ('assignedUserId' in body) {
    if (body.assignedUserId === null) {
      data.assignedUserId = null
      data.assignedAt = null
    } else if (typeof body.assignedUserId === 'string') {
      // Authorise: the target user must be a workspace member.
      const member = await db.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId: body.assignedUserId, workspaceId } },
        select: { userId: true },
      })
      if (!member) {
        return NextResponse.json({ error: 'Target user isn\'t a workspace member.' }, { status: 400 })
      }
      data.assignedUserId = body.assignedUserId
      data.assignedAt = now
    }
  }
  if (typeof body.subject === 'string' && body.subject.trim()) {
    data.subject = body.subject.trim().slice(0, 255)
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }
  data.lastActivityAt = now

  const ticket = await db.ticket.update({
    where: { id: ticketId },
    data,
    include: { assignedUser: { select: { id: true, name: true, email: true, image: true } } },
  })
  return NextResponse.json({ ticket })
}
