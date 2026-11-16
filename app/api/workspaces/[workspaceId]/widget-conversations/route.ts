import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { loadLastMessagePreviews } from '@/lib/widget-message-preview'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:id/widget-conversations
 *
 * Lists all widget conversations across every widget in this workspace.
 * Each row includes the latest message preview and visitor identity.
 * The preview is a separate DISTINCT ON query (see
 * lib/widget-message-preview) — nesting `messages: { take: 1 }` here
 * made Postgres return every message for the page of conversations.
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
    widget: {
      select: {
        id: true, name: true, primaryColor: true,
        brand: { select: { id: true, name: true, slug: true, logoUrl: true, primaryColor: true } },
      },
    },
    visitor: { select: { id: true, name: true, email: true, cookieId: true } },
    assignedUser: { select: { id: true, name: true, email: true, image: true } },
    _count: { select: { messages: true } },
  }
  try {
    conversations = await db.widgetConversation.findMany({
      where: { widget: { workspaceId, humanEnabled: true } },
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

  const previews = await loadLastMessagePreviews(conversations.map((c: any) => c.id))

  const shaped = conversations.map((c: any) => ({
    id: c.id,
    widget: c.widget ? {
      id: c.widget.id,
      name: c.widget.name,
      primaryColor: c.widget.primaryColor,
    } : null,
    // Brand info denormalized onto each row so the inbox can render
    // chips and filter without extra fetches. Pulled through
    // widget.brand at query time; null when the widget isn't tagged.
    brand: c.widget?.brand ? {
      id: c.widget.brand.id,
      name: c.widget.brand.name,
      slug: c.widget.brand.slug,
      logoUrl: c.widget.brand.logoUrl,
      primaryColor: c.widget.brand.primaryColor,
    } : null,
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
    lastMessage: (() => {
      const preview = previews.get(c.id)
      if (!preview) return null
      return {
        role: preview.role,
        sentByUserId: preview.sentByUserId ?? null,
        content: (preview.content || '').slice(0, 120),
        kind: preview.kind,
        createdAt: preview.createdAt.toISOString(),
      }
    })(),
  }))

  return NextResponse.json({ conversations: shaped })
}
