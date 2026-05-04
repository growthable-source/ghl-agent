import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { createList, type SmartListFilter } from '@/lib/crm/native/lists'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const lists = await db.nativeContactList.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { members: true } } },
  })
  return NextResponse.json({ lists })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = await req.json()
  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'name required' }, { status: 400 })
  }
  const list = await createList({
    workspaceId,
    name: body.name.trim(),
    description: body.description?.trim() || undefined,
    type: body.type === 'smart' ? 'smart' : 'static',
    filter: (body.filter as SmartListFilter | undefined) ?? undefined,
    createdBy: access.session.user.id,
  })
  return NextResponse.json({ list }, { status: 201 })
}
