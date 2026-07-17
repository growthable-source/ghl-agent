import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { sendTicketingEmail, isTransientSendFailure } from '@/lib/ticketing-send'
import { notify } from '@/lib/notifications'

type Params = { params: Promise<{ workspaceId: string; ticketId: string }> }

/**
 * POST { body, direction?, sendEmail? } — append a message to a
 * ticket and, when direction='outbound' + sendEmail=true, deliver it
 * via Resend.
 *
 *   direction defaults to 'outbound' (the common case is replying)
 *   sendEmail defaults to true for outbound. internal_note is never
 *   emailed regardless.
 *
 * Reopen rule: when the ticket is in a terminal state (closed /
 * resolved) and an inbound message lands, we'd want to reopen — but
 * this endpoint is operator-driven, so inbound posts are only for
 * backfilling. The actual reopen-on-reply behaviour fires from the
 * future inbound-email webhook.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, ticketId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, workspaceId },
    include: { workspace: { select: { name: true } } },
  })
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (!text) return NextResponse.json({ error: 'Message body required.' }, { status: 400 })

  const direction = body.direction === 'inbound' || body.direction === 'internal_note'
    ? body.direction
    : 'outbound'
  const sendEmail = direction === 'outbound' && body.sendEmail !== false

  const now = new Date()
  let emailMeta: { messageId: string | null; sentAt: Date | null } = { messageId: null, sentAt: null }
  let emailError: string | null = null
  let emailNextRetryAt: Date | null = null

  if (sendEmail) {
    const send = await sendTicketingEmail({
      workspaceId,
      to: ticket.contactEmail,
      subject: ticket.subject,
      text,
      ticketRef: { id: ticket.id, number: ticket.ticketNumber },
      includeSignature: true,
    })
    if (!send.ok) {
      emailError = send.reason
      // Transient (429/5xx/network) → hand to the retry cron. Config
      // failures (unverified domain, no from-email, bad key) retry
      // identically-broken, so they stay terminal and the operator is told.
      emailNextRetryAt = isTransientSendFailure(send) ? new Date(now.getTime() + 2 * 60_000) : null
      notify({
        workspaceId,
        event: 'agent_error',
        title: `Ticket #${ticket.ticketNumber}: reply email failed to send`,
        body: emailNextRetryAt
          ? `${send.reason} Retrying automatically.`
          : send.reason,
        link: `/dashboard/${workspaceId}/tickets/${ticket.id}`,
        severity: 'error',
      }).catch(() => {})
    } else {
      emailMeta = { messageId: send.messageId, sentAt: now }
    }
  }

  const baseData = {
    ticketId: ticket.id,
    direction,
    body: text,
    sentByUserId: direction === 'outbound' || direction === 'internal_note' ? access.session.user!.id : null,
    sentAt: emailMeta.sentAt,
    messageId: emailMeta.messageId,
  }
  const messageInclude = { sentByUser: { select: { id: true, name: true, email: true, image: true } } }
  let message
  try {
    message = await db.ticketMessage.create({
      data: {
        ...baseData,
        ...(emailError ? { emailError, emailAttempts: 1, emailNextRetryAt } : {}),
      },
      include: messageInclude,
    })
  } catch (err: any) {
    // Pre-migration DB (failure-tracking columns not applied yet): the
    // message must still be recorded, just without the retry bookkeeping.
    if (emailError && (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? ''))) {
      message = await db.ticketMessage.create({ data: baseData, include: messageInclude })
    } else {
      throw err
    }
  }

  // Bump the ticket's activity bookkeeping. Inbound messages on a
  // closed/resolved ticket trigger auto-reopen when the workspace
  // setting allows — mirrors the Resend Inbound webhook behaviour so
  // operators who manually log an inbound note see the same flow.
  const data: Record<string, unknown> = { lastActivityAt: now }
  if (direction === 'outbound') data.lastOutboundAt = now
  if (direction === 'inbound') {
    data.lastInboundAt = now
    const wasTerminal = ticket.status === 'closed' || ticket.status === 'resolved'
    if (wasTerminal) {
      const settings = await (db as any).ticketingSettings.findUnique({
        where: { workspaceId },
        select: { autoReopenOnReply: true },
      }).catch(() => null)
      if (settings?.autoReopenOnReply ?? true) {
        data.status = 'open'
        data.reopenedAt = now
        data.closedAt = null
      }
    }
  }
  await db.ticket.update({ where: { id: ticket.id }, data })

  return NextResponse.json({ message, emailSent: !!emailMeta.sentAt, emailError })
}

// sendTicketEmail moved to lib/ticketing-send.ts — see sendTicketingEmail.
