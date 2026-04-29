import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; collectionId: string; entryId: string }> }

/**
 * PATCH — edit an entry's title/content.
 * DELETE — remove the entry from the collection (and from every agent
 * connected to it). Other agents using *other* collections are
 * unaffected.
 */

async function loadGuarded(workspaceId: string, collectionId: string, entryId: string) {
  return db.knowledgeEntry.findFirst({
    where: { id: entryId, collectionId, collection: { workspaceId } },
    select: { id: true },
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, collectionId, entryId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const existing = await loadGuarded(workspaceId, collectionId, entryId)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const data: Record<string, unknown> = {}
  if (typeof body.title === 'string' && body.title.trim()) data.title = body.title.trim()
  if (typeof body.content === 'string') data.content = body.content
  if (body.sourceUrl !== undefined) {
    data.sourceUrl = typeof body.sourceUrl === 'string' && body.sourceUrl.trim() ? body.sourceUrl.trim() : null
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const entry = await db.knowledgeEntry.update({ where: { id: entryId }, data })
  return NextResponse.json({ entry })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, collectionId, entryId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const existing = await loadGuarded(workspaceId, collectionId, entryId)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db.knowledgeEntry.delete({ where: { id: entryId } })
  return NextResponse.json({ success: true })
}
