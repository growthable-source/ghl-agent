import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireLocationAccess } from '@/lib/require-access'

type Params = { params: Promise<{ locationId: string; entryId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { locationId, entryId } = await params
  const access = await requireLocationAccess(locationId)
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
  const { locationId, entryId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
  await db.knowledgeEntry.delete({ where: { id: entryId } })
  return NextResponse.json({ success: true })
}
