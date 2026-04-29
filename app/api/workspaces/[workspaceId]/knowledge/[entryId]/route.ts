import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; entryId: string }> }

/**
 * Legacy entry-by-id route. Entries now live inside collections — use
 * /workspaces/:wid/knowledge/collections/:cid/entries/:eid for create/
 * edit/delete. We keep GET working for read-only fetches (deep links,
 * external integrations) but redirect-style 410 for mutations to point
 * callers at the new path.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, entryId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const entry = await db.knowledgeEntry.findFirst({
    where: { id: entryId, workspaceId },
    include: {
      collection: { select: { id: true, name: true } },
    },
  }).catch(() => null)
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    entry: {
      id: entry.id,
      title: entry.title,
      content: entry.content,
      source: entry.source,
      sourceUrl: entry.sourceUrl,
      tokenEstimate: entry.tokenEstimate,
      status: entry.status,
      collection: entry.collection ? { id: entry.collection.id, name: entry.collection.name } : null,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    },
  })
}

export function PATCH() {
  return NextResponse.json({
    error: 'Entries are now edited under their collection. Use PATCH /workspaces/[id]/knowledge/collections/[cid]/entries/[entryId].',
    code: 'WORKSPACE_LEVEL_ENTRY_EDIT_REMOVED',
  }, { status: 410 })
}
export function DELETE() {
  return NextResponse.json({
    error: 'Entries are now deleted under their collection. Use DELETE /workspaces/[id]/knowledge/collections/[cid]/entries/[entryId].',
    code: 'WORKSPACE_LEVEL_ENTRY_DELETE_REMOVED',
  }, { status: 410 })
}
