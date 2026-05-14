import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { formatConversations, isValidFormat, EXPORT_CONTENT_TYPE, EXPORT_EXTENSION } from '@/lib/widget-export'

type Params = { params: Promise<{ workspaceId: string; conversationId: string }> }

/**
 * GET /api/workspaces/:ws/widget-conversations/:cid/export?format=csv|md|json
 *
 * Download a single conversation in the requested format. Sets a
 * Content-Disposition header so the browser auto-saves with a sane
 * filename. Defaults to markdown — most operators want to share / read.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const reqFormat = url.searchParams.get('format') ?? 'md'
  const format = isValidFormat(reqFormat) ? reqFormat : 'md'

  const c = await db.widgetConversation.findFirst({
    where: { id: conversationId, widget: { workspaceId } },
    include: {
      widget: { select: { id: true, name: true, brand: { select: { id: true, name: true, slug: true } } } },
      visitor: { select: { id: true, name: true, email: true, phone: true } },
      assignedUser: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { createdAt: 'asc' } },
    } as any,
  }) as any
  if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = formatConversations([{
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
    messages: c.messages.map((m: any) => ({
      id: m.id, role: m.role, content: m.content, kind: m.kind, createdAt: m.createdAt,
    })),
  }], format)

  const filename = `conversation-${conversationId}.${EXPORT_EXTENSION[format]}`
  return new NextResponse(body, {
    headers: {
      'Content-Type': EXPORT_CONTENT_TYPE[format],
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
