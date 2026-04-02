import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type Params = { params: Promise<{ entryId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { entryId } = await params
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
  const { entryId } = await params
  await db.knowledgeEntry.delete({ where: { id: entryId } })
  return NextResponse.json({ success: true })
}
