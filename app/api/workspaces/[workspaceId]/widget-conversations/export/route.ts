import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { formatConversations, isValidFormat, EXPORT_CONTENT_TYPE, EXPORT_EXTENSION } from '@/lib/widget-export'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:ws/widget-conversations/export?format=csv|md|json&...
 *
 * Bulk export. Accepts the same filters the inbox uses:
 *   - brand=<slug>   only this brand (or 'untagged')
 *   - status=active|handed_off|ended
 *   - assignee=<userId> | 'unassigned'
 *   - from=ISO  to=ISO
 *   - ids=<comma-separated cuid list>  (overrides everything else)
 *
 * Capped at 500 conversations per export to keep payload + transaction
 * bounded. Operators who need more should split by brand / date range.
 */
const MAX_CONVERSATIONS = 500

export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const reqFormat = url.searchParams.get('format') ?? 'csv'
  const format = isValidFormat(reqFormat) ? reqFormat : 'csv'

  const idsParam = url.searchParams.get('ids')
  const explicitIds = idsParam ? idsParam.split(',').filter(Boolean).slice(0, MAX_CONVERSATIONS) : null

  const where: any = { widget: { workspaceId } }
  if (explicitIds && explicitIds.length > 0) {
    where.id = { in: explicitIds }
  } else {
    const status = url.searchParams.get('status')
    if (status && ['active', 'handed_off', 'ended'].includes(status)) where.status = status
    const brand = url.searchParams.get('brand')
    if (brand === 'untagged') where.widget = { workspaceId, brandId: null }
    else if (brand) where.widget = { workspaceId, brand: { slug: brand } }
    const assignee = url.searchParams.get('assignee')
    if (assignee === 'unassigned') where.assignedUserId = null
    else if (assignee) where.assignedUserId = assignee
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (from || to) {
      where.createdAt = {}
      if (from) where.createdAt.gte = new Date(from)
      if (to) where.createdAt.lte = new Date(to)
    }
  }

  const convos = await db.widgetConversation.findMany({
    where,
    include: {
      widget: { select: { id: true, name: true, brand: { select: { id: true, name: true, slug: true } } } },
      visitor: { select: { id: true, name: true, email: true, phone: true } },
      assignedUser: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { createdAt: 'asc' } },
    } as any,
    orderBy: { createdAt: 'desc' },
    take: MAX_CONVERSATIONS,
  }) as any[]

  const shaped = convos.map(c => ({
    id: c.id,
    status: c.status,
    createdAt: c.createdAt,
    lastMessageAt: c.lastMessageAt,
    csatRating: c.csatRating ?? null,
    csatComment: c.csatComment ?? null,
    initiatedUrl: c.initiatedUrl ?? null,
    widget: c.widget ? { id: c.widget.id, name: c.widget.name } : null,
    brand: c.widget?.brand ? { id: c.widget.brand.id, name: c.widget.brand.name, slug: c.widget.brand.slug } : null,
    visitor: c.visitor ? {
      id: c.visitor.id, name: c.visitor.name, email: c.visitor.email, phone: c.visitor.phone ?? null,
    } : null,
    assignedUser: c.assignedUser ? { id: c.assignedUser.id, name: c.assignedUser.name, email: c.assignedUser.email } : null,
    messages: (c.messages ?? []).map((m: any) => ({
      id: m.id, role: m.role, content: m.content, kind: m.kind, createdAt: m.createdAt,
    })),
  }))

  const body = formatConversations(shaped, format)
  const stamp = new Date().toISOString().slice(0, 10)
  const filename = `conversations-${stamp}.${EXPORT_EXTENSION[format]}`
  return new NextResponse(body, {
    headers: {
      'Content-Type': EXPORT_CONTENT_TYPE[format],
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Export-Count': String(convos.length),
    },
  })
}
