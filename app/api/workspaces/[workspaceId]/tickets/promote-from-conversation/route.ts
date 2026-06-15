import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { getTicketingStatus } from '@/lib/ticketing-access'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * POST { conversationId, subject?, priority? } — promote a widget
 * conversation into a ticket. Requires the visitor's email to be set
 * (the whole point of a ticket vs a chat is the email turnaround).
 *
 * Idempotent: if the conversation is already linked to a ticket,
 * returns the existing one instead of erroring.
 *
 * Side-effects:
 *   - Backfills the ticket's message thread with the conversation's
 *     visitor messages (role='visitor' → direction='inbound',
 *     role='agent' → direction='outbound'). Operators land in the
 *     ticket and see the full history without context loss.
 *   - Stamps lastInboundAt / lastOutboundAt off the latest of each.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const status = await getTicketingStatus(workspaceId)
  if (!status.active) {
    return NextResponse.json({ error: 'Ticketing is not active for this workspace.', code: status.reason }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId required.' }, { status: 400 })
  }

  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widget: { workspaceId } },
    include: {
      visitor: true,
      messages: { orderBy: { createdAt: 'asc' } },
      ticket: { select: { id: true, ticketNumber: true } },
      // Pull the widget's brand so the new Ticket can denormalise it
      // — reports + filter chips query by brand directly without
      // walking ticket → conversation → widget → brand each time.
      widget: { select: { brandId: true } },
    },
  })
  if (!convo) return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })

  if (convo.ticket) {
    return NextResponse.json({ ticket: convo.ticket, alreadyExists: true })
  }

  const email = (convo.visitor.email || '').trim().toLowerCase()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({
      error: 'This conversation has no visitor email. Tickets need an email to follow up over.',
      code: 'EMAIL_REQUIRED',
    }, { status: 400 })
  }

  const subject = typeof body.subject === 'string' && body.subject.trim()
    ? body.subject.trim().slice(0, 255)
    : deriveSubject(convo.messages)

  // crmContactId — try to link to a NativeContact if the email
  // already exists. Best-effort; failure here is silent.
  let crmContactId: string | null = null
  try {
    const contact = await (db as any).nativeContact.findFirst({
      where: { workspaceId, email },
      select: { id: true },
    })
    crmContactId = contact?.id ?? null
  } catch { /* table missing pre-migration */ }

  // Operator summary for the top of the ticket. Uses the chat's cached
  // summary when present (instant — ended chats already have one);
  // otherwise generates one now. Best-effort; never blocks promotion.
  let chatSummary: string | null = null
  try {
    const { generateConversationSummary } = await import('@/lib/conversation-summary')
    chatSummary = (await generateConversationSummary(conversationId))?.summary ?? null
  } catch { /* best-effort */ }

  const ticket = await db.$transaction(async (tx) => {
    const last = await tx.ticket.findFirst({
      where: { workspaceId },
      orderBy: { ticketNumber: 'desc' },
      select: { ticketNumber: true },
    })
    const ticketNumber = (last?.ticketNumber ?? 0) + 1

    // Auto-assign rule: inherit from the source chat if a human was
    // already on it; otherwise hand the ticket to the promoter. This
    // matches the operator's mental model — whoever owns the chat
    // owns the follow-up, and clicking Promote on an AI-only chat is
    // an implicit "I'll take this from here."
    const assignedUserId = convo.assignedUserId ?? access.session.user!.id
    const assignedAt = convo.assignedAt ?? new Date()

    const created = await tx.ticket.create({
      data: {
        workspaceId,
        ticketNumber,
        conversationId,
        brandId: convo.widget.brandId ?? null,
        contactEmail: email,
        contactName: convo.visitor.name,
        contactPhone: convo.visitor.phone,
        crmContactId,
        subject,
        priority: typeof body.priority === 'string' && ['low','normal','high','urgent'].includes(body.priority) ? body.priority : 'normal',
        status: 'open',
        assignedUserId,
        assignedAt,
        createdByUserId: access.session.user!.id,
        summary: chatSummary,
        lastActivityAt: new Date(),
      },
    })

    // Backfill the message thread from the source conversation.
    let lastInbound: Date | null = null
    let lastOutbound: Date | null = null
    const seedMessages = convo.messages.map(m => {
      const direction: 'inbound' | 'outbound' | 'internal_note' =
        m.role === 'visitor' ? 'inbound' : 'outbound'
      if (direction === 'inbound' && (!lastInbound || m.createdAt > lastInbound)) lastInbound = m.createdAt
      if (direction === 'outbound' && (!lastOutbound || m.createdAt > lastOutbound)) lastOutbound = m.createdAt
      return {
        ticketId: created.id,
        direction,
        body: m.content,
        createdAt: m.createdAt,
        // Preserve original chat timestamps for audit fidelity.
      }
    })
    if (seedMessages.length > 0) {
      await tx.ticketMessage.createMany({ data: seedMessages })
    }

    return tx.ticket.update({
      where: { id: created.id },
      data: { lastInboundAt: lastInbound, lastOutboundAt: lastOutbound },
    })
  })

  // The chat has officially moved to email. End the conversation so
  // the visitor's composer disappears, and broadcast a ticket_created
  // event so the widget can swap the generic closure card for a
  // ticket-specific one ("We've created ticket #N — we'll follow up
  // via email at <email>."). Both side-effects are best-effort: a
  // broadcast / status update failure here doesn't undo the ticket.
  try {
    await db.widgetConversation.update({
      where: { id: conversationId },
      data: { status: 'ended', lastMessageAt: new Date() },
    })
  } catch (err) {
    console.warn('[promote] failed to end conversation:', err instanceof Error ? err.message : err)
  }
  try {
    const { broadcast } = await import('@/lib/widget-sse')
    // Custom event first so the widget can stash the ticket info
    // BEFORE the generic status_changed → ended flips the closure
    // banner on. Same channel, processed in order by the EventSource.
    await broadcast(conversationId, {
      type: 'ticket_created',
      ticketNumber: ticket.ticketNumber,
      contactEmail: ticket.contactEmail,
    })
    await broadcast(conversationId, { type: 'status_changed', status: 'ended' })
  } catch (err) {
    console.warn('[promote] broadcast failed:', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({ ticket }, { status: 201 })
}

/** First visitor message → subject, truncated. Falls back when the
 *  thread has no visitor turn yet (rare — promote usually happens
 *  after at least one exchange). */
function deriveSubject(messages: Array<{ role: string; content: string }>): string {
  const firstVisitor = messages.find(m => m.role === 'visitor')
  const seed = firstVisitor?.content?.trim() || messages[0]?.content?.trim() || 'New ticket'
  // Single-line, ≤80 chars to keep the inbox-style subject readable.
  const oneLine = seed.replace(/\s+/g, ' ')
  return oneLine.length > 80 ? oneLine.slice(0, 77) + '…' : oneLine
}
