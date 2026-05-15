import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { getTicketingStatus } from '@/lib/ticketing-access'

type Params = { params: Promise<{ workspaceId: string }> }

const VALID_STATUSES = new Set(['open', 'pending', 'on_hold', 'resolved', 'closed'])
const VALID_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent'])

/**
 * GET — list tickets with optional ?status=...&assignee=me|<userId>|unassigned
 *       Returns the rows the dashboard renders (grid + kanban share the
 *       same payload — the view toggle is purely client-side).
 *
 * POST — create a ticket from scratch (manual entry). The
 *        promote-from-conversation flow uses /promote-from-conversation
 *        instead because it needs different input shape + side effects.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const status = await getTicketingStatus(workspaceId)
  if (!status.active) {
    return NextResponse.json({ tickets: [], inactive: true, reason: status.reason, allBrands: [], members: [] })
  }

  const url = new URL(req.url)
  const statusFilter = url.searchParams.get('status')
  const assigneeFilter = url.searchParams.get('assignee')
  const brandFilter = url.searchParams.get('brandId')
  const priorityFilter = url.searchParams.get('priority')
  const fromParam = url.searchParams.get('from')
  const toParam = url.searchParams.get('to')
  const daysParam = url.searchParams.get('days')

  const where: Prisma.TicketWhereInput = { workspaceId }
  if (statusFilter && VALID_STATUSES.has(statusFilter)) {
    where.status = statusFilter
  } else if (statusFilter === 'open_only') {
    // Convenience bucket the kanban excludes from its "in flight"
    // columns — open + pending + on_hold, anything not terminal.
    where.status = { in: ['open', 'pending', 'on_hold'] }
  }
  if (assigneeFilter === 'me') {
    where.assignedUserId = access.session.user!.id
  } else if (assigneeFilter === 'unassigned') {
    where.assignedUserId = null
  } else if (assigneeFilter && /^[a-z0-9_-]+$/i.test(assigneeFilter)) {
    where.assignedUserId = assigneeFilter
  }
  if (brandFilter === 'no_brand') {
    where.brandId = null
  } else if (brandFilter && /^[a-z0-9_-]+$/i.test(brandFilter)) {
    where.brandId = brandFilter
  }
  if (priorityFilter && VALID_PRIORITIES.has(priorityFilter)) {
    where.priority = priorityFilter
  }
  // Date window — created-in. Same two-mode shape as CSAT
  // (?days=N OR ?from=YYYY-MM-DD&to=YYYY-MM-DD), explicit takes
  // precedence.
  if (fromParam && toParam && !Number.isNaN(Date.parse(fromParam)) && !Number.isNaN(Date.parse(toParam))) {
    const from = new Date(fromParam)
    const to = new Date(toParam)
    to.setHours(23, 59, 59, 999)
    where.createdAt = { gte: from, lte: to }
  } else if (daysParam) {
    const days = Math.max(1, Math.min(365, Number(daysParam) || 30))
    where.createdAt = { gte: new Date(Date.now() - days * 86_400_000) }
  }

  // Sort param — defaults to "in-flight first, then newest activity"
  // which matches what an operator opening the page wants. Other
  // sorts are useful for reporting drilldowns from the reports page.
  const sortParam = url.searchParams.get('sort')
  const orderBy: Prisma.TicketOrderByWithRelationInput[] =
    sortParam === 'priority' ? [{ priority: 'desc' }, { lastActivityAt: 'desc' }]
    : sortParam === 'created' ? [{ createdAt: 'desc' }]
    : sortParam === 'oldest'  ? [{ createdAt: 'asc' }]
    : sortParam === 'closed'  ? [{ closedAt: 'desc' }]
    : [{ status: 'asc' }, { lastActivityAt: 'desc' }]

  const tickets = await db.ticket.findMany({
    where,
    orderBy,
    take: 500,
    select: {
      id: true,
      ticketNumber: true,
      subject: true,
      status: true,
      priority: true,
      contactEmail: true,
      contactName: true,
      assignedUserId: true,
      assignedUser: { select: { id: true, name: true, email: true, image: true } },
      brandId: true,
      brand: { select: { id: true, name: true, primaryColor: true } },
      lastActivityAt: true,
      lastInboundAt: true,
      lastOutboundAt: true,
      closedAt: true,
      createdAt: true,
      conversationId: true,
    },
  }).catch(() => [])

  // Brand list + member list for the filter dropdowns. Cheap — both
  // small per-workspace. Returned alongside the tickets so the page
  // doesn't need extra round-trips on load.
  const [allBrands, members] = await Promise.all([
    db.brand.findMany({
      where: { workspaceId },
      select: { id: true, name: true, primaryColor: true },
      orderBy: { name: 'asc' },
    }).catch(() => []),
    db.workspaceMember.findMany({
      where: { workspaceId },
      select: { user: { select: { id: true, name: true, email: true, image: true } } },
      orderBy: { createdAt: 'asc' },
    }).catch(() => []),
  ])

  return NextResponse.json({
    allBrands,
    members: members.map(m => m.user),
    tickets: tickets.map(t => ({
      ...t,
      lastActivityAt: t.lastActivityAt.toISOString(),
      lastInboundAt: t.lastInboundAt?.toISOString() ?? null,
      lastOutboundAt: t.lastOutboundAt?.toISOString() ?? null,
      closedAt: t.closedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
    inactive: false,
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const status = await getTicketingStatus(workspaceId)
  if (!status.active) {
    return NextResponse.json({ error: 'Ticketing is not active for this workspace.', code: status.reason }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const contactEmail = typeof body.contactEmail === 'string' ? body.contactEmail.trim().toLowerCase() : ''
  const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
  if (!contactEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    return NextResponse.json({ error: 'A valid contactEmail is required.' }, { status: 400 })
  }
  if (!subject) {
    return NextResponse.json({ error: 'subject is required.' }, { status: 400 })
  }

  const priority = typeof body.priority === 'string' && VALID_PRIORITIES.has(body.priority) ? body.priority : 'normal'

  const ticket = await db.$transaction(async (tx) => {
    // Workspace-scoped sequential number. Cheap enough at our volume;
    // if it ever becomes a hotspot, migrate to a sequence.
    const last = await tx.ticket.findFirst({
      where: { workspaceId },
      orderBy: { ticketNumber: 'desc' },
      select: { ticketNumber: true },
    })
    return tx.ticket.create({
      data: {
        workspaceId,
        ticketNumber: (last?.ticketNumber ?? 0) + 1,
        contactEmail,
        contactName: typeof body.contactName === 'string' ? body.contactName.slice(0, 120) : null,
        contactPhone: typeof body.contactPhone === 'string' ? body.contactPhone.slice(0, 30) : null,
        subject: subject.slice(0, 255),
        priority,
        status: 'open',
      },
    })
  })

  return NextResponse.json({ ticket }, { status: 201 })
}
