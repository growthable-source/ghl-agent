import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

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

  if (sendEmail) {
    const send = await sendTicketEmail({
      workspaceId,
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      to: ticket.contactEmail,
      subject: ticket.subject,
      body: text,
    })
    if (!send.ok) {
      emailError = send.reason
    } else {
      emailMeta = { messageId: send.messageId, sentAt: now }
    }
  }

  const message = await db.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      direction,
      body: text,
      sentByUserId: direction === 'outbound' || direction === 'internal_note' ? access.session.user!.id : null,
      sentAt: emailMeta.sentAt,
      messageId: emailMeta.messageId,
    },
    include: { sentByUser: { select: { id: true, name: true, email: true, image: true } } },
  })

  // Bump the ticket's activity bookkeeping.
  const data: Record<string, unknown> = { lastActivityAt: now }
  if (direction === 'outbound') data.lastOutboundAt = now
  if (direction === 'inbound')  data.lastInboundAt = now
  await db.ticket.update({ where: { id: ticket.id }, data })

  return NextResponse.json({ message, emailSent: !!emailMeta.sentAt, emailError })
}

/**
 * Deliver an outbound reply via Resend. Returns { ok, messageId,
 * reason } so the caller can persist the Message-ID for future
 * threading and surface failures to the operator.
 *
 * Uses TicketingSettings.fromEmail / fromName when present; otherwise
 * NOTIFICATION_FROM_EMAIL env (same default as digests). Signature
 * appended when the operator has one set.
 */
async function sendTicketEmail(p: {
  workspaceId: string
  ticketId: string
  ticketNumber: number
  to: string
  subject: string
  body: string
}): Promise<{ ok: true; messageId: string | null } | { ok: false; reason: string; messageId: null }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return { ok: false, reason: 'RESEND_API_KEY not set on this deployment.', messageId: null }

  const settings = await (db as any).ticketingSettings.findUnique({
    where: { workspaceId: p.workspaceId },
    select: { fromEmail: true, fromName: true, signature: true },
  }).catch(() => null)

  const fromAddr = settings?.fromEmail || process.env.NOTIFICATION_FROM_EMAIL_ADDRESS || process.env.NOTIFICATION_FROM_EMAIL
  const fromName = settings?.fromName || 'Support'
  if (!fromAddr) return { ok: false, reason: 'No from-email configured for this workspace.', messageId: null }
  const from = fromAddr.includes('<') ? fromAddr : `${fromName} <${fromAddr}>`

  // Prefix subject with [#1042] so replies thread visually in the
  // recipient's inbox client even before our inbound-webhook lands.
  const subjectWithRef = `[#${p.ticketNumber}] ${p.subject}`
  const bodyWithSig = settings?.signature
    ? `${p.body}\n\n--\n${settings.signature}`
    : p.body

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [p.to],
      subject: subjectWithRef,
      text: bodyWithSig,
      // Carries a stable reply path for the future inbound webhook.
      headers: { 'X-Voxility-Ticket-Id': p.ticketId },
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    return { ok: false, reason: `Resend ${res.status}: ${errText.slice(0, 200)}`, messageId: null }
  }
  const data = await res.json().catch(() => ({} as { id?: string }))
  return { ok: true, messageId: data?.id ?? null }
}
