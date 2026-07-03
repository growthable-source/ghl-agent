import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; ticketId: string }> }

/**
 * GET — the brand snippet library for this ticket's brand, for the
 * compose UI (operators click to insert a snippet into their reply).
 * Snippets are maintained by portal users on /portal/knowledge.
 * Tickets with no brand have no snippets.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, ticketId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, workspaceId },
    select: { brandId: true },
  })
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
  if (!ticket.brandId) return NextResponse.json({ snippets: [] })

  const snippets = await db.brandSnippet.findMany({
    where: { brandId: ticket.brandId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, title: true, content: true, kind: true },
  }).catch(() => []) // pre-migration: table missing

  return NextResponse.json({ snippets })
}
