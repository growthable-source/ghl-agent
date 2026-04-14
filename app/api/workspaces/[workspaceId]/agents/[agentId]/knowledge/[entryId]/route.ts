import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; entryId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, entryId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()
  const entry = await db.knowledgeEntry.update({
    where: { id: entryId },
    data: {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.content !== undefined && { content: body.content }),
    },
  })
  return NextResponse.json({ entry })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, entryId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  await db.knowledgeEntry.delete({ where: { id: entryId } })
  return NextResponse.json({ success: true })
}
