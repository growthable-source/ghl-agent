import { NextRequest, NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { can } from '@/lib/permissions'
import { broadcast } from '@/lib/widget-sse'

type Params = { params: Promise<{ workspaceId: string }> }

const MAX_IDS = 200

/**
 * Bulk conversation action — currently just "close" (status='ended').
 * Mirrors the per-conversation PATCH end path: flips status, broadcasts
 * status_changed, and runs the same CRM resolve-sync per conversation
 * in after() so closing in bulk is identical to closing one at a time.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  if (!can(access.role, 'conversations.reply')) {
    return NextResponse.json({ error: 'Your role is read-only — you can view conversations but not change them.' }, { status: 403 })
  }

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === 'string').slice(0, MAX_IDS) : []
  const status = body.status as string
  if (ids.length === 0) return NextResponse.json({ error: 'ids required' }, { status: 400 })
  if (status !== 'ended') return NextResponse.json({ error: "only status 'ended' is supported" }, { status: 400 })

  // Scope to conversations actually in this workspace — never trust the
  // client's id list to be in-bounds.
  const owned = await db.widgetConversation.findMany({
    where: { id: { in: ids }, widget: { workspaceId }, status: { not: 'ended' } },
    select: { id: true },
  })
  const ownedIds = owned.map(c => c.id)
  if (ownedIds.length === 0) return NextResponse.json({ ok: true, closed: 0 })

  await db.widgetConversation.updateMany({
    where: { id: { in: ownedIds } },
    data: { status: 'ended' },
  })

  for (const id of ownedIds) {
    await broadcast(id, { type: 'status_changed', status: 'ended' })
  }

  // CRM resolve-sync per conversation, after the response — same as the
  // single-conversation end path.
  after(async () => {
    const { tagAndNoteOnResolve } = await import('@/lib/widget-crm-sync')
    for (const id of ownedIds) {
      try {
        const full = await db.widgetConversation.findUnique({
          where: { id },
          include: { widget: true, visitor: true },
        })
        if (!full) continue
        await tagAndNoteOnResolve({
          workspaceId,
          visitor: full.visitor as any,
          conversationId: id,
          widgetName: full.widget.name || 'widget',
        })
      } catch (err: any) {
        console.warn('[widget] bulk CRM resolve sync failed:', err?.message)
      }
    }
  })

  return NextResponse.json({ ok: true, closed: ownedIds.length })
}
