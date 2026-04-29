import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { searchConversations } from '@/lib/conversation-search'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET — server-backed conversation search. Powers the inbox search
 * box (full-text across every message + metadata) AND determines
 * which conversations the export endpoint will include.
 *
 * Query params:
 *   q           — free-text search (visitor, message, assignee, brand, …)
 *   brand       — brand slug to scope to, or 'untagged'
 *   status      — 'active' | 'handed_off' | 'ended'
 *   from / to   — ISO date range
 *
 * Response includes per-row match metadata (which fields matched) and
 * up to 3 short snippets from matching messages, so the inbox can
 * surface "matched in transcript" chips with context.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const q = url.searchParams.get('q')
  const brand = url.searchParams.get('brand')
  const status = url.searchParams.get('status')
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')

  let results
  try {
    results = await searchConversations({
      workspaceId,
      q,
      brandSlug: brand,
      status,
      from,
      to,
      take: 100,
    })
  } catch (err: any) {
    if (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ conversations: [], notMigrated: true })
    }
    throw err
  }

  const shaped = results.map(({ conversation: c, matchedIn, snippets }) => ({
    id: c.id,
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
    visitor: c.visitor,
    agentId: c.agentId,
    status: c.status,
    messageCount: c._count?.messages ?? c.messages?.length ?? 0,
    csatRating: c.csatRating ?? null,
    csatComment: c.csatComment ?? null,
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
    // When q is set we have the full thread loaded; pull the latest
    // message for the preview shape regardless. Avoids the inbox row
    // having to special-case the search-vs-list response shape.
    lastMessage: (c.messages && c.messages.length > 0) ? (() => {
      const last = c.messages[c.messages.length - 1]
      return {
        role: last.role,
        content: (last.content || '').slice(0, 120),
        kind: last.kind,
        createdAt: last.createdAt.toISOString(),
      }
    })() : null,
    matchedIn,
    snippets,
  }))

  return NextResponse.json({ conversations: shaped, query: q ?? '' })
}
