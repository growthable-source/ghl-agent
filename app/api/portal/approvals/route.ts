import { NextResponse } from 'next/server'
import { getPortalSession } from '@/lib/portal-auth'
import { db } from '@/lib/db'

/**
 * GET — the portal user's approval queue: reply drafts submitted by the
 * support team for tickets on their brands, awaiting sign-off. Includes
 * the last inbound customer message per ticket so the reviewer sees what
 * the draft is answering, plus recently decided drafts for context.
 */
export async function GET() {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.brandIds.length === 0) {
    return NextResponse.json({ pending: [], recentDecided: [] })
  }

  try {
    const [pending, recentDecided] = await Promise.all([
      db.ticketReplyDraft.findMany({
        where: { status: 'pending', ticket: { brandId: { in: session.brandIds } } },
        orderBy: { createdAt: 'asc' },
        take: 50,
        select: draftSelect,
      }),
      db.ticketReplyDraft.findMany({
        where: { status: { in: ['approved', 'rejected'] }, ticket: { brandId: { in: session.brandIds } } },
        orderBy: { reviewedAt: 'desc' },
        take: 20,
        select: draftSelect,
      }),
    ])
    return NextResponse.json({ pending: pending.map(shape), recentDecided: recentDecided.map(shape) })
  } catch {
    // Pre-migration: TicketReplyDraft table missing.
    return NextResponse.json({ pending: [], recentDecided: [] })
  }
}

const draftSelect = {
  id: true,
  body: true,
  status: true,
  reviewNote: true,
  reviewedByEmail: true,
  reviewedAt: true,
  createdAt: true,
  submittedByUser: { select: { name: true, email: true } },
  ticket: {
    select: {
      id: true,
      ticketNumber: true,
      subject: true,
      status: true,
      contactEmail: true,
      contactName: true,
      brand: { select: { id: true, name: true } },
      messages: {
        where: { direction: 'inbound' },
        orderBy: { createdAt: 'desc' as const },
        take: 1,
        select: { body: true, createdAt: true },
      },
    },
  },
} as const

type DraftRow = {
  id: string
  body: string
  status: string
  reviewNote: string | null
  reviewedByEmail: string | null
  reviewedAt: Date | null
  createdAt: Date
  submittedByUser: { name: string | null; email: string | null } | null
  ticket: {
    id: string
    ticketNumber: number
    subject: string
    status: string
    contactEmail: string
    contactName: string | null
    brand: { id: string; name: string } | null
    messages: Array<{ body: string; createdAt: Date }>
  }
}

function shape(d: DraftRow) {
  return {
    id: d.id,
    body: d.body,
    status: d.status,
    reviewNote: d.reviewNote,
    reviewedByEmail: d.reviewedByEmail,
    reviewedAt: d.reviewedAt,
    createdAt: d.createdAt,
    submittedBy: d.submittedByUser?.name || d.submittedByUser?.email || 'Support team',
    ticket: {
      id: d.ticket.id,
      ticketNumber: d.ticket.ticketNumber,
      subject: d.ticket.subject,
      status: d.ticket.status,
      contactEmail: d.ticket.contactEmail,
      contactName: d.ticket.contactName,
      brandName: d.ticket.brand?.name ?? null,
      lastInbound: d.ticket.messages[0]?.body ?? null,
    },
  }
}
