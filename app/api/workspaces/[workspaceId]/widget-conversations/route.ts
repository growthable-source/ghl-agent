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

  const shaped = conversations.map((c: any) => ({
    id: c.id,
    widget: c.widget,
    visitor: c.visitor,
    agentId: c.agentId,
    status: c.status,
    messageCount: c._count?.messages ?? 0,
    csatRating: c.csatRating ?? null,
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
