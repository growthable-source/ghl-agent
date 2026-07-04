import { NextRequest, NextResponse } from 'next/server'
import { getPortalSession } from '@/lib/portal-auth'
import { db } from '@/lib/db'
import { sendTicketingEmail } from '@/lib/ticketing-send'

type Params = { params: Promise<{ draftId: string }> }

/**
 * POST { action: 'approve' | 'reject', note? } — decide a pending reply
 * draft for a ticket on one of the reviewer's brands.
 *
 * Approve = send. The email goes out through the same Resend path a
 * direct dashboard reply uses (signature, [#N] subject threading), a
 * TicketMessage is recorded with the original submitter as author, and
 * the ticket's activity bookkeeping is bumped. If Resend fails, the
 * message is still recorded (matching /messages behaviour) and the
 * error is surfaced.
 *
 * Reject = the draft goes back to the support team with the note;
 * nothing is sent.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { draftId } = await params

  const body = await req.json().catch(() => ({}))
  const action = body.action === 'approve' || body.action === 'reject' ? body.action : null
  if (!action) return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 2000) : null

  const draft = await db.ticketReplyDraft.findUnique({
    where: { id: draftId },
    select: {
      id: true,
      body: true,
      status: true,
      submittedByUserId: true,
      ticket: {
        select: {
          id: true, workspaceId: true, brandId: true,
          ticketNumber: true, subject: true, contactEmail: true, status: true,
        },
      },
    },
  }).catch(() => null)
  if (!draft || !draft.ticket.brandId || !session.brandIds.includes(draft.ticket.brandId)) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  }
  if (draft.status !== 'pending') {
    return NextResponse.json({ error: `This draft was already ${draft.status}.` }, { status: 409 })
  }

  const now = new Date()
  // Admin-preview sessions have no PortalUser row — record email only.
  const reviewerId = session.userId === 'admin-preview' ? null : session.userId
  const reviewFields = {
    reviewedByPortalUserId: reviewerId,
    reviewedByEmail: session.email,
    reviewedAt: now,
    reviewNote: note,
  }

  if (action === 'reject') {
    await db.ticketReplyDraft.update({
      where: { id: draft.id },
      data: { status: 'rejected', ...reviewFields },
    })
    return NextResponse.json({ ok: true, status: 'rejected' })
  }

  // ── Approve: send through the standard ticketing email path ─────────
  const send = await sendTicketingEmail({
    workspaceId: draft.ticket.workspaceId,
    to: draft.ticket.contactEmail,
    subject: draft.ticket.subject,
    text: draft.body,
    ticketRef: { id: draft.ticket.id, number: draft.ticket.ticketNumber },
    includeSignature: true,
  })
  const emailError = send.ok ? null : send.reason

  const message = await db.ticketMessage.create({
    data: {
      ticketId: draft.ticket.id,
      direction: 'outbound',
      body: draft.body,
      sentByUserId: draft.submittedByUserId,
      sentAt: send.ok ? now : null,
      messageId: send.messageId,
    },
    select: { id: true },
  })

  await Promise.all([
    db.ticketReplyDraft.update({
      where: { id: draft.id },
      data: { status: 'approved', sentMessageId: message.id, ...reviewFields },
    }),
    db.ticket.update({
      where: { id: draft.ticket.id },
      data: { lastActivityAt: now, lastOutboundAt: now },
    }),
  ])

  return NextResponse.json({ ok: true, status: 'approved', emailSent: send.ok, emailError })
}
