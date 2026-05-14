/**
 * Unified inbox feed.
 *
 * Returns widget conversations + Meta (Messenger / Instagram)
 * conversations as a single recency-sorted list. The shape stays
 * compatible with the older /widget-conversations endpoint — Meta rows
 * synthesize widget/visitor fields so the existing UI code can render
 * them with minimal changes — plus a `source` discriminator + `channel`
 * tag the UI uses to pick the right pill icon.
 *
 * The MetaConversation tables are optional: if the manual SQL migration
 * hasn't been applied yet (P2021), Meta rows are silently dropped and
 * the response is widget-only. Same fail-open posture as the widget
 * route uses for its own routing-assignment migration.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

// Brand-orange accent for FB; pink-ish for IG. Used as the avatar
// gradient when no profile pic is available, matching the widget
// row's `primaryColor` treatment.
const CHANNEL_ACCENT = {
  messenger: '#1877F2', // Facebook brand blue
  instagram: '#E4405F', // Instagram brand pink
} as const

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const [widgets, metas] = await Promise.all([
    fetchWidgetRows(workspaceId),
    fetchMetaRows(workspaceId),
  ])

  // Sort: priority first (lower group.priority = higher rank), then
  // recency. Conversations from un-grouped brands fall through to a
  // sentinel (9999) so they sit below every named group. Meta channels
  // don't have brands; treat them as ungrouped.
  const UNGROUPED = 9999
  const combined = [...widgets, ...metas].sort((a, b) => {
    const ap = (a as any).brandGroup?.priority ?? UNGROUPED
    const bp = (b as any).brandGroup?.priority ?? UNGROUPED
    if (ap !== bp) return ap - bp
    return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
  }).slice(0, 200)

  return NextResponse.json({ conversations: combined })
}

async function fetchWidgetRows(workspaceId: string): Promise<any[]> {
  const fullInclude = {
    widget: {
      select: {
        id: true, name: true, primaryColor: true,
        brand: {
          select: {
            id: true, name: true, slug: true, logoUrl: true, primaryColor: true,
            // Optional priority group — surfaced on the conversation
            // so the operator can see the chip + the sort prioritises.
            brandGroup: { select: { id: true, name: true, priority: true, color: true } },
          },
        },
      },
    },
    visitor: { select: { id: true, name: true, email: true, cookieId: true } },
    messages: { orderBy: { createdAt: 'desc' as const }, take: 1 },
    assignedUser: { select: { id: true, name: true, email: true, image: true } },
    _count: { select: { messages: true } },
  }
  let conversations: any[]
  try {
    conversations = await db.widgetConversation.findMany({
      where: { widget: { workspaceId } },
      orderBy: { lastMessageAt: 'desc' },
      take: 150,
      include: fullInclude as any,
    })
  } catch (err: any) {
    if (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')) {
      try {
        conversations = await db.widgetConversation.findMany({
          where: { widget: { workspaceId } },
          orderBy: { lastMessageAt: 'desc' },
          take: 150,
          include: {
            widget: { select: { id: true, name: true, primaryColor: true } },
            visitor: { select: { id: true, name: true, email: true, cookieId: true } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
            _count: { select: { messages: true } },
          },
        })
      } catch {
        return []
      }
    } else {
      return []
    }
  }

  return conversations.map((c: any) => ({
    id: c.id,
    source: 'widget' as const,
    channel: 'widget' as const,
    widget: c.widget ? {
      id: c.widget.id,
      name: c.widget.name,
      primaryColor: c.widget.primaryColor,
    } : null,
    brand: c.widget?.brand ? {
      id: c.widget.brand.id,
      name: c.widget.brand.name,
      slug: c.widget.brand.slug,
      logoUrl: c.widget.brand.logoUrl,
      primaryColor: c.widget.brand.primaryColor,
    } : null,
    brandGroup: c.widget?.brand?.brandGroup ? {
      id: c.widget.brand.brandGroup.id,
      name: c.widget.brand.brandGroup.name,
      priority: c.widget.brand.brandGroup.priority,
      color: c.widget.brand.brandGroup.color,
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
    lastMessage: c.messages[0] ? {
      role: c.messages[0].role,
      content: (c.messages[0].content || '').slice(0, 120),
      kind: c.messages[0].kind,
      createdAt: c.messages[0].createdAt.toISOString(),
    } : null,
  }))
}

async function fetchMetaRows(workspaceId: string): Promise<any[]> {
  let conversations: any[]
  try {
    conversations = await db.metaConversation.findMany({
      where: { workspaceId },
      orderBy: { lastMessageAt: 'desc' },
      take: 150,
      include: {
        assignedUser: { select: { id: true, name: true, email: true, image: true } },
        _count: { select: { messages: true } },
      },
    })
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      // Migration not applied yet — render widget-only inbox.
      return []
    }
    console.error('[inbox] meta fetch failed:', err?.message)
    return []
  }

  return conversations.map((c: any) => {
    const accent = CHANNEL_ACCENT[c.channel as 'messenger' | 'instagram'] ?? '#fa4d2e'
    const senderLabel = c.senderName || `User ${String(c.senderId).slice(-6)}`
    return {
      // Prefix Meta IDs so the detail-page route can dispatch by source
      // without colliding with widget cuids in the URL.
      id: `meta:${c.id}`,
      source: 'meta' as const,
      channel: c.channel as 'messenger' | 'instagram',
      // Synthesize a `widget`-shaped object so the existing list-row
      // renderer doesn't need a parallel branch for Meta. The "name"
      // slot becomes the Page name (which is what we want shown).
      widget: {
        id: c.pageId,
        name: c.pageName || (c.channel === 'instagram' ? 'Instagram' : 'Facebook Page'),
        primaryColor: accent,
      },
      brand: null,
      visitor: {
        id: c.senderId,
        name: senderLabel,
        email: null,
        cookieId: c.senderId,
        avatarUrl: c.senderProfilePicUrl ?? null,
      },
      agentId: c.agentId,
      status: c.status,
      messageCount: c._count?.messages ?? 0,
      csatRating: null,
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
      lastMessage: c.lastMessagePreview ? {
        // Map our 'in' / 'out' onto the role vocabulary the UI uses for
        // widget messages so the prefix icon (👤 / 🤖) keeps working
        // without a special case. Operator-typed Meta replies will have
        // sentByUserId set; we don't surface that distinction in the
        // list row, just in the detail view.
        role: c.lastMessageDirection === 'out' ? 'agent' : 'visitor',
        content: c.lastMessagePreview,
        kind: undefined,
        createdAt: c.lastMessageAt.toISOString(),
      } : null,
    }
  })
}
