import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { getTicketingStatus } from '@/lib/ticketing-access'
import { createTicket } from '@/lib/ticket-create'

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

  // Assignment: the brand's ticket routing decides FIRST — "all of this
  // brand's tickets go to its designated person/pool" must hold no
  // matter which operator happened to work the chat or click Promote.
  // Only when routing picks nobody (manual mode, stale config) do we
  // fall back to the chat's human, then the promoter, so the ticket is
  // never ownerless.
  const ticket = await createTicket({
    workspaceId,
    conversationId,
    brandId: convo.widget.brandId ?? null,
    contactEmail: email,
    contactName: convo.visitor.name,
    contactPhone: convo.visitor.phone,
    crmContactId,
    subject,
    priority: typeof body.priority === 'string' && ['low','normal','high','urgent'].includes(body.priority) ? body.priority : 'normal',
    createdByUserId: access.session.user!.id,
    summary: chatSummary,
    assign: { mode: 'auto', fallbackUserId: convo.assignedUserId ?? access.session.user!.id },
    // Backfill the message thread from the source conversation,
    // preserving original chat timestamps for audit fidelity.
    seedMessages: convo.messages.map(m => ({
      direction: m.role === 'visitor' ? 'inbound' as const : 'outbound' as const,
      body: m.content,
      createdAt: m.createdAt,
    })),
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
