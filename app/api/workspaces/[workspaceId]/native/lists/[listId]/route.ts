import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { deleteList, getListContacts } from '@/lib/crm/native/lists'

type Params = { params: Promise<{ workspaceId: string; listId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId, listId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const list = await db.nativeContactList.findFirst({
    where: { id: listId, workspaceId },
    include: { _count: { select: { members: true } } },
  })
  if (!list) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const url = new URL(req.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1') || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '50') || 50))

  const result = await getListContacts({
    workspaceId,
    listId,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  })
  return NextResponse.json({ list, ...result, page, pageSize })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, listId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = await req.json()
  const data: Prisma.NativeContactListUpdateInput = {}
  if (body.name !== undefined) data.name = String(body.name).trim()
  if (body.description !== undefined) data.description = body.description ?? null
  if (body.filter !== undefined) {
    data.filter = body.filter
      ? (body.filter as Prisma.InputJsonValue)
      : Prisma.JsonNull
  }

  const result = await db.nativeContactList.updateMany({
    where: { id: listId, workspaceId },
    data,
  })
  if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const list = await db.nativeContactList.findUnique({ where: { id: listId } })
  return NextResponse.json({ list })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, listId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  await deleteList(workspaceId, listId)
  return NextResponse.json({ ok: true })
}
