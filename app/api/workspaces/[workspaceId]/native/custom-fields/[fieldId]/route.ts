import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; fieldId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, fieldId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = await req.json()
  const data: Prisma.NativeCustomFieldUpdateInput = {}
  // Note: fieldKey is intentionally NOT editable — once data exists keyed
  // off it, renaming would orphan every contact's value. Create a new field.
  if (body.name !== undefined) data.name = String(body.name).trim()
  if (body.placeholder !== undefined) data.placeholder = body.placeholder ?? null
  if (body.position !== undefined) data.position = Number(body.position)
  if (body.options !== undefined) {
    data.options = body.options
      ? (body.options as Prisma.InputJsonValue)
      : Prisma.JsonNull
  }

  const result = await db.nativeCustomField.updateMany({
    where: { id: fieldId, workspaceId },
    data,
  })
  if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const field = await db.nativeCustomField.findUnique({ where: { id: fieldId } })
  return NextResponse.json({ field })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, fieldId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // Note: this leaves the values orphaned in NativeContact.customFields
  // JSON blobs. They'll just become unreachable via merge tags. We don't
  // sweep them out — disk is cheap and the operator might restore the
  // field later.
  const result = await db.nativeCustomField.deleteMany({
    where: { id: fieldId, workspaceId },
  })
  if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
