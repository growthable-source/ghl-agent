import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isSuperAdmin } from '@/lib/help-auth'

type Params = { params: Promise<{ slug: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { slug } = await params
  const { ok } = await isSuperAdmin()
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const category = await db.helpCategory.update({
    where: { slug },
    data: {
      ...(body.name !== undefined && { name: String(body.name).trim() }),
      ...(body.description !== undefined && { description: body.description?.trim() || null }),
      ...(body.icon !== undefined && { icon: body.icon?.trim() || null }),
      ...(body.order !== undefined && { order: Number(body.order) }),
    },
  })
  return NextResponse.json({ category })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { slug } = await params
  const { ok } = await isSuperAdmin()
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // onDelete: SetNull in the schema — articles in this category become
  // uncategorised rather than being deleted.
  await db.helpCategory.delete({ where: { slug } })
  return NextResponse.json({ success: true })
}
