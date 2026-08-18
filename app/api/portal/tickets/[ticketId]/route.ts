import { NextRequest, NextResponse } from 'next/server'
import { getPortalSession } from '@/lib/portal-auth'
import { db } from '@/lib/db'

type Params = { params: Promise<{ ticketId: string }> }

const VALID_STATUSES = new Set(['open', 'pending', 'on_hold', 'resolved', 'closed'])

/**
 * Portal ticket detail — the brand-side ticket workspace.
 *
 * GET   — ticket header + full message thread + this ticket's pending
 *         reply drafts (so the approve/reject controls can render
 *         inline). Internal notes are NEVER returned: they're the
 *         workspace team's private channel.
 * PATCH — { status } only. Portal users manage state and reply; the
 *         assignee is a workspace-staff concern (a different auth
 *         realm), shown read-only.
 *
 * Authorization: portal session + the ticket's brand must be in
 * session.brandIds (re-fetched from the DB per request). Brandless
 * tickets are invisible to the portal by design — same guard shape as
 * app/api/portal/approvals/[draftId].
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { ticketId } = await params

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      workspaceId: true,
      ticketNumber: true,
      subject: true,
      status: true,
      priority: true,
      brandId: true,
      brand: { select: { id: true, name: true, primaryColor: true, logoUrl: true } },
      contactEmail: true,
      contactName: true,
      summary: true,
      assignedUser: { select: { name: true } },
      lastActivityAt: true,
      createdAt: true,
      messages: {
        where: { direction: { not: 'internal_note' } },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          direction: true,
          body: true,
          fromEmail: true,
          fromName: true,
          sentAt: true,
          emailError: true,
          createdAt: true,
          sentByUser: { select: { name: true } },
        },
      },
      replyDrafts: {
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          body: true,
          createdAt: true,
          submittedByUser: { select: { name: true } },
        },
      },
    },
  }).catch(() => null)

  if (!ticket || !ticket.brandId || !session.brandIds.includes(ticket.brandId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    ticket: {
      ...ticket,
      lastActivityAt: ticket.lastActivityAt.toISOString(),
      createdAt: ticket.createdAt.toISOString(),
      messages: ticket.messages.map(m => ({
        ...m,
        sentAt: m.sentAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
      })),
      replyDrafts: ticket.replyDrafts.map(d => ({
        ...d,
        createdAt: d.createdAt.toISOString(),
      })),
    },
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { ticketId } = await params

  const existing = await db.ticket.findUnique({
    where: { id: ticketId },
    select: { id: true, status: true, brandId: true },
  }).catch(() => null)
  if (!existing || !existing.brandId || !session.brandIds.includes(existing.brandId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}))
  if (typeof body.status !== 'string' || !VALID_STATUSES.has(body.status)) {
    return NextResponse.json({ error: 'status must be one of open, pending, on_hold, resolved, closed.' }, { status: 400 })
  }

  // Same terminal-state bookkeeping as the dashboard PATCH: closing
  // stamps closedAt; leaving a terminal state stamps reopenedAt and
  // clears closedAt so reporting can show the reopen.
  const now = new Date()
  const data: Record<string, unknown> = { status: body.status, lastActivityAt: now }
  const wasTerminal = existing.status === 'closed' || existing.status === 'resolved'
  const isTerminal = body.status === 'closed' || body.status === 'resolved'
  if (isTerminal && !wasTerminal) data.closedAt = now
  if (!isTerminal && wasTerminal) { data.reopenedAt = now; data.closedAt = null }

  const ticket = await db.ticket.update({
    where: { id: ticketId },
    data,
    select: { id: true, status: true, closedAt: true, reopenedAt: true },
  })
  return NextResponse.json({ ticket })
}
