/**
 * Out-of-band retry for failed ticket emails.
 *
 * The reply endpoints (dashboard + portal approval) record the
 * TicketMessage even when the Resend send fails, so the thread stays
 * truthful — but historically nothing ever re-sent the email, and the
 * failure was invisible. They now stamp emailError / emailNextRetryAt
 * on transient failures; this module is the cron half that drains them.
 *
 * Called every minute from /api/cron/native-outbox (the outbound-delivery
 * cron). Terminal outcomes (non-transient error, retries exhausted) keep
 * emailError set with emailNextRetryAt null so the thread badge stays red
 * and the operator notification is the last word.
 */

import { db } from './db'
import { sendTicketingEmail, isTransientSendFailure } from './ticketing-send'
import { notify } from './notifications'

const MAX_ATTEMPTS = 5

/** Backoff schedule by attempt count already made: 2m, 5m, 15m, 60m. */
function nextDelayMs(attempts: number): number {
  const schedule = [2, 5, 15, 60]
  return (schedule[Math.min(attempts - 1, schedule.length - 1)]) * 60_000
}

export async function retryFailedTicketEmails(limit = 20): Promise<{ scanned: number; sent: number; gaveUp: number }> {
  const now = new Date()
  let rows: Array<{
    id: string
    body: string
    emailAttempts: number
    ticket: { id: string; workspaceId: string; ticketNumber: number; subject: string; contactEmail: string }
  }>
  try {
    rows = await db.ticketMessage.findMany({
      where: { emailNextRetryAt: { lte: now }, sentAt: null },
      select: {
        id: true,
        body: true,
        emailAttempts: true,
        ticket: { select: { id: true, workspaceId: true, ticketNumber: true, subject: true, contactEmail: true } },
      },
      orderBy: { emailNextRetryAt: 'asc' },
      take: limit,
    })
  } catch (err: any) {
    // Pre-migration DB (columns not applied yet) — skip quietly rather
    // than failing the whole cron.
    if (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')) {
      return { scanned: 0, sent: 0, gaveUp: 0 }
    }
    throw err
  }

  let sent = 0
  let gaveUp = 0
  for (const row of rows) {
    const attempts = row.emailAttempts + 1
    const send = await sendTicketingEmail({
      workspaceId: row.ticket.workspaceId,
      to: row.ticket.contactEmail,
      subject: row.ticket.subject,
      text: row.body,
      ticketRef: { id: row.ticket.id, number: row.ticket.ticketNumber },
      includeSignature: true,
    })

    if (send.ok) {
      await db.ticketMessage.update({
        where: { id: row.id },
        data: { sentAt: new Date(), messageId: send.messageId, emailError: null, emailAttempts: attempts, emailNextRetryAt: null },
      }).catch(() => {})
      sent++
      continue
    }

    const retryAgain = isTransientSendFailure(send) && attempts < MAX_ATTEMPTS
    await db.ticketMessage.update({
      where: { id: row.id },
      data: {
        emailError: send.reason,
        emailAttempts: attempts,
        emailNextRetryAt: retryAgain ? new Date(Date.now() + nextDelayMs(attempts)) : null,
      },
    }).catch(() => {})

    if (!retryAgain) {
      gaveUp++
      notify({
        workspaceId: row.ticket.workspaceId,
        event: 'agent_error',
        title: `Ticket #${row.ticket.ticketNumber}: reply email could not be delivered`,
        body: `Gave up after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${send.reason}`,
        link: `/dashboard/${row.ticket.workspaceId}/tickets/${row.ticket.id}`,
        severity: 'error',
      }).catch(() => {})
    }
  }

  return { scanned: rows.length, sent, gaveUp }
}
