import { NextRequest, NextResponse } from 'next/server'
import { getPortalSession } from '@/lib/portal-auth'
import { db } from '@/lib/db'
import { sendTicketingEmail, isTransientSendFailure } from '@/lib/ticketing-send'
import { getTicketingStatus } from '@/lib/ticketing-access'
import { notify } from '@/lib/notifications'

type Params = { params: Promise<{ ticketId: string }> }

/**
 * POST { body } — a portal user replies to a ticket directly from the
 * portal ticket workspace. Sends through the same Resend path a
 * dashboard reply uses (signature, [#N] subject threading) and records
 * the TicketMessage with PORTAL attribution: sentByPortalUserId (null
 * for the FK-less admin-preview session) plus fromEmail/fromName from
 * the session so authorship survives account deletion.
 *
 * This deliberately bypasses the reply-draft approval flow — that flow
 * exists so brand-side people sign off on what workspace staff drafted,
 * and the portal user IS the sign-off authority. Pending drafts are
 * left untouched (the reviewer's call), surfaced by the detail GET.
 *
 * Send-failure handling mirrors app/api/portal/approvals/[draftId]:
 * the message is still recorded with emailError + retry bookkeeping so
 * the retry cron picks it up, and the workspace team is notified.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { ticketId } = await params

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true, workspaceId: true, brandId: true,
      ticketNumber: true, subject: true, contactEmail: true,
    },
  }).catch(() => null)
  if (!ticket || !ticket.brandId || !session.brandIds.includes(ticket.brandId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const status = await getTicketingStatus(ticket.workspaceId)
  if (!status.active) {
    return NextResponse.json({ error: 'Ticketing is not active for this workspace.', code: status.reason }, { status: 403 })
  }

  const reqBody = await req.json().catch(() => ({}))
  const text = typeof reqBody.body === 'string' ? reqBody.body.trim() : ''
  if (!text) return NextResponse.json({ error: 'Reply body is required.' }, { status: 400 })
  if (text.length > 100_000) return NextResponse.json({ error: 'Reply is too long.' }, { status: 400 })

  const now = new Date()
  const send = await sendTicketingEmail({
    workspaceId: ticket.workspaceId,
    to: ticket.contactEmail,
    subject: ticket.subject,
    text,
    ticketRef: { id: ticket.id, number: ticket.ticketNumber },
    includeSignature: true,
  })
  const emailError = send.ok ? null : send.reason

  if (!send.ok) {
    const willRetry = isTransientSendFailure(send)
    notify({
      workspaceId: ticket.workspaceId,
      event: 'agent_error',
      title: `Ticket #${ticket.ticketNumber}: portal reply failed to send`,
      body: willRetry ? `${send.reason} Retrying automatically.` : send.reason,
      link: `/dashboard/${ticket.workspaceId}/tickets/${ticket.id}`,
      severity: 'error',
    }).catch(() => {})
  }

  const baseData = {
    ticketId: ticket.id,
    direction: 'outbound',
    body: text,
    // Admin-preview sessions have no PortalUser row — attribute by
    // email/name only, same special case as the approvals route.
    sentByPortalUserId: session.userId === 'admin-preview' ? null : session.userId,
    fromEmail: session.email,
    fromName: session.name,
    sentAt: send.ok ? now : null,
    messageId: send.messageId,
  }
  let message: { id: string }
  try {
    message = await db.ticketMessage.create({
      data: {
        ...baseData,
        ...(emailError
          ? {
              emailError,
              emailAttempts: 1,
              emailNextRetryAt: isTransientSendFailure(send) ? new Date(now.getTime() + 2 * 60_000) : null,
            }
          : {}),
      },
      select: { id: true },
    })
  } catch (err) {
    // Pre-migration DB (sentByPortalUserId / failure-tracking columns
    // not applied yet) — record with the columns that do exist.
    const e = err as { code?: string; message?: string }
    if (e?.code === 'P2022' || /column .* does not exist/i.test(e?.message ?? '')) {
      const withoutPortalFk: Record<string, unknown> = { ...baseData }
      delete withoutPortalFk.sentByPortalUserId
      message = await db.ticketMessage.create({ data: withoutPortalFk as never, select: { id: true } })
    } else {
      throw err
    }
  }

  await db.ticket.update({
    where: { id: ticket.id },
    data: { lastActivityAt: now, lastOutboundAt: now },
  })

  return NextResponse.json({ ok: true, messageId: message.id, emailSent: send.ok, emailError }, { status: 201 })
}
