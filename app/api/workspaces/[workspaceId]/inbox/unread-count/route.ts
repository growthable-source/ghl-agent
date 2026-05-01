/**
 * Lightweight unread-count for the sidebar inbox badge.
 *
 * "Unread" = an inbound the operator hasn't acted on yet.
 *
 *   - Widget threads: latest message is from the visitor and the
 *     conversation is not ended. Mirrors the same isUnread heuristic
 *     the inbox list uses (page.tsx:546).
 *   - Meta threads: MetaConversation.unreadCount > 0. Cleared when
 *     the operator opens the thread (markMetaConversationRead).
 *
 * Returns just `{ count: number }` so this can be polled cheaply
 * every 30s by NavCountsProvider without dragging full conversation
 * payloads down on each tick.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const [widgetUnread, metaUnread] = await Promise.all([
    countUnreadWidgets(workspaceId),
    countUnreadMeta(workspaceId),
  ])
  return NextResponse.json({ count: widgetUnread + metaUnread })
}

async function countUnreadWidgets(workspaceId: string): Promise<number> {
  // We approximate "latest message is from visitor" with raw SQL because
  // a Prisma query that filters on the latest related row needs a
  // subquery — cheaper to express directly. Falls back to 0 if the
  // routing-assignment migration isn't applied (the inbox itself
  // already has this fallback so we mirror the contract).
  try {
    const result = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "WidgetConversation" wc
      JOIN "ChatWidget" w ON w.id = wc."widgetId"
      WHERE w."workspaceId" = ${workspaceId}
        AND wc."status" != 'ended'
        AND EXISTS (
          SELECT 1 FROM "WidgetMessage" m
          WHERE m."conversationId" = wc.id
            AND m."role" = 'visitor'
            AND m."createdAt" = (
              SELECT MAX("createdAt") FROM "WidgetMessage"
              WHERE "conversationId" = wc.id
            )
        )
    `
    return Number(result[0]?.count ?? 0)
  } catch {
    return 0
  }
}

async function countUnreadMeta(workspaceId: string): Promise<number> {
  // Number of threads with anything unread, not total unread messages —
  // a thread with 5 unread is still one badge-worthy item.
  try {
    return await db.metaConversation.count({
      where: { workspaceId, unreadCount: { gt: 0 } },
    })
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) return 0
    return 0
  }
}
