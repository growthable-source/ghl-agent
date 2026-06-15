import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'
import { getTicketingStatus } from '@/lib/ticketing-access'

type Params = { params: Promise<{ widgetId: string; conversationId: string }> }

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: widgetCorsHeaders(req.headers.get('origin')) })
}

/**
 * POST — a queued visitor leaves their email to get a follow-up. We open
 * a support ticket linked to this conversation (idempotent with the
 * operator-side promote: Ticket.conversationId is unique, so a later
 * promote returns the same ticket). Gated on ticketing being active.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { widgetId, conversationId } = await params
  const v = await validateWidgetRequest(req, widgetId)
  const headers = widgetCorsHeaders(req.headers.get('origin'))
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers })

  const body = (await req.json().catch(() => ({}))) as { email?: string }
  const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'A valid email is required.' }, { status: 400, headers })
  }

  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widgetId },
    include: {
      visitor: { select: { id: true, name: true, email: true } },
      ticket: { select: { id: true, ticketNumber: true } },
      widget: { select: { workspaceId: true, brandId: true } },
      messages: { orderBy: { createdAt: 'asc' }, take: 1, select: { content: true } },
    },
  })
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404, headers })

  const workspaceId = convo.widget.workspaceId
  const status = await getTicketingStatus(workspaceId)
  if (!status.active) {
    // Ticketing not active — record the email on the visitor so an
    // operator can still follow up manually, and report softly.
    if (!convo.visitor.email) {
      await db.widgetVisitor.update({ where: { id: convo.visitor.id }, data: { email } }).catch(() => {})
    }
    return NextResponse.json({ ok: true, ticketed: false }, { headers })
  }

  // Persist the email on the visitor if we didn't have one.
  if (!convo.visitor.email) {
    await db.widgetVisitor.update({ where: { id: convo.visitor.id }, data: { email } }).catch(() => {})
  }

  // Already promoted → return the existing ticket (idempotent).
  if (convo.ticket) {
    return NextResponse.json({ ok: true, ticketed: true, ticketNumber: convo.ticket.ticketNumber }, { headers })
  }

  const subject =
    (convo.messages[0]?.content || '').trim().slice(0, 120) || 'Follow-up requested from live chat'

  const ticket = await db.$transaction(async tx => {
    const last = await tx.ticket.findFirst({
      where: { workspaceId },
      orderBy: { ticketNumber: 'desc' },
      select: { ticketNumber: true },
    })
    return tx.ticket.create({
      data: {
        workspaceId,
        ticketNumber: (last?.ticketNumber ?? 0) + 1,
        conversationId,
        brandId: convo.widget.brandId ?? null,
        contactEmail: email,
        contactName: convo.visitor.name,
        subject,
        status: 'open',
        lastActivityAt: new Date(),
        lastInboundAt: new Date(),
      },
    })
  })

  return NextResponse.json({ ok: true, ticketed: true, ticketNumber: ticket.ticketNumber }, { headers })
}
