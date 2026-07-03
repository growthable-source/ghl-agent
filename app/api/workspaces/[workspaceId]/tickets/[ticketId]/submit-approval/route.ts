import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; ticketId: string }> }

/**
 * Ticket reply sign-off — the dashboard side of the approval workflow.
 *
 *   GET    — drafts for this ticket (pending first), for the compose UI
 *            banner.
 *   POST   { body } — submit a composed reply for portal approval. One
 *            pending draft per ticket at a time. Requires the ticket to
 *            be linked to a brand — approvers are the brand's portal
 *            users, so a brandless draft would be invisible to everyone.
 *   DELETE ?draftId= — withdraw a pending draft (only while pending).
 *
 * The portal decides via /api/portal/approvals/[draftId]; approving
 * there sends the email.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, ticketId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const ticket = await db.ticket.findFirst({ where: { id: ticketId, workspaceId }, select: { id: true } })
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })

  const drafts = await db.ticketReplyDraft.findMany({
    where: { ticketId },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true, body: true, status: true, reviewNote: true,
      reviewedByEmail: true, reviewedAt: true, createdAt: true,
      submittedByUser: { select: { name: true, email: true } },
    },
  }).catch(() => []) // pre-migration: table missing

  return NextResponse.json({ drafts })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, ticketId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, workspaceId },
    select: { id: true, brandId: true },
  })
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  if (!ticket.brandId) {
    return NextResponse.json(
      { error: 'This ticket isn’t linked to a brand, so there are no portal users who could approve it. Send directly instead.' },
      { status: 400 },
    )
  }

  const payload = await req.json().catch(() => ({}))
  const text = typeof payload.body === 'string' ? payload.body.trim() : ''
  if (!text) return NextResponse.json({ error: 'Reply body required.' }, { status: 400 })

  try {
    const existing = await db.ticketReplyDraft.findFirst({
      where: { ticketId, status: 'pending' },
      select: { id: true },
    })
    if (existing) {
      return NextResponse.json(
        { error: 'A draft is already awaiting approval for this ticket. Withdraw it first to submit a new one.' },
        { status: 409 },
      )
    }

    const draft = await db.ticketReplyDraft.create({
      data: {
        ticketId,
        body: text,
        status: 'pending',
        submittedByUserId: access.session.user!.id,
      },
      select: { id: true, status: true, createdAt: true },
    })
    return NextResponse.json({ draft })
  } catch {
    return NextResponse.json(
      { error: 'Approval workflow isn’t initialised on this database yet (TicketReplyDraft migration pending).' },
      { status: 503 },
    )
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { workspaceId, ticketId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const draftId = req.nextUrl.searchParams.get('draftId') ?? ''
  if (!draftId) return NextResponse.json({ error: 'draftId required' }, { status: 400 })

  const draft = await db.ticketReplyDraft.findFirst({
    where: { id: draftId, ticketId, ticket: { workspaceId } },
    select: { id: true, status: true },
  }).catch(() => null)
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  if (draft.status !== 'pending') {
    return NextResponse.json({ error: `Only pending drafts can be withdrawn (this one is ${draft.status}).` }, { status: 409 })
  }

  await db.ticketReplyDraft.update({ where: { id: draft.id }, data: { status: 'cancelled' } })
  return NextResponse.json({ ok: true })
}
