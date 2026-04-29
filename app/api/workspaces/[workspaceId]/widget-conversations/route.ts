import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:id/widget-conversations
 *
 * Lists all widget conversations across every widget in this workspace.
 * Each row includes the latest message preview and visitor identity.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let conversations: any[] = []
  // Try the full include (with assignedUser) first; fall back to a bare
  // include if the routing-assignment migration hasn't been applied yet.
  // This same shape is consumed by both the inbox list and the per-user
  // "assigned to me" filter, so missing assignment data must degrade to
  // "everyone is unassigned" rather than 500ing the inbox.
  const fullInclude = {
    widget: { select: { id: true, name: true, primaryColor: true } },
    visitor: { select: { id: true, name: true, email: true, cookieId: true } },
    messages: { orderBy: { createdAt: 'desc' as const }, take: 1 },
    assignedUser: { select: { id: true, name: true, email: true, image: true } },
    _count: { select: { messages: true } },
  }
  try {
    conversations = await db.widgetConversation.findMany({
      where: { widget: { workspaceId } },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      include: fullInclude as any,
    })
  } catch (err: any) {
    if (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')) {
      try {
        conversations = await db.widgetConversation.findMany({
          where: { widget: { workspaceId } },
          orderBy: { lastMessageAt: 'desc' },
          take: 100,
          include: {
            widget: { select: { id: true, name: true, primaryColor: true } },
            visitor: { select: { id: true, name: true, email: true, cookieId: true } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
            _count: { select: { messages: true } },
          },
        })
      } catch {
        return NextResponse.json({ conversations: [], notMigrated: true })
      }
    } else {
      return NextResponse.json({ conversations: [], notMigrated: true })
    }
  }

  const shaped = conversations.map((c: any) => ({
    id: c.id,
    widget: c.widget,
    visitor: c.visitor,
    agentId: c.agentId,
    status: c.status,
    messageCount: c._count?.messages ?? 0,
    csatRating: c.csatRating ?? null,
    assignedUserId: c.assignedUserId ?? null,
    assignedUser: c.assignedUser ? {
      id: c.assignedUser.id,
      name: c.assignedUser.name,
      email: c.assignedUser.email,
      image: c.assignedUser.image,
    } : null,
    assignedAt: c.assignedAt ? c.assignedAt.toISOString() : null,
    assignmentReason: c.assignmentReason ?? null,
    lastMessageAt: c.lastMessageAt.toISOString(),
    lastMessage: c.messages[0] ? {
      role: c.messages[0].role,
      content: (c.messages[0].content || '').slice(0, 120),
      kind: c.messages[0].kind,
      createdAt: c.messages[0].createdAt.toISOString(),
    } : null,
  }))

  return NextResponse.json({ conversations: shaped })
}
