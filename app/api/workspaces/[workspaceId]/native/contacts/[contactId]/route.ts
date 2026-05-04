import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { normalizeEmail, normalizePhone } from '@/lib/crm/native/normalize'

type Params = { params: Promise<{ workspaceId: string; contactId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, contactId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const contact = await db.nativeContact.findFirst({
    where: { id: contactId, workspaceId },
    include: {
      listMemberships: { include: { list: { select: { id: true, name: true } } } },
      conversations: {
        orderBy: { lastMessageAt: 'desc' },
        take: 10,
        include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      },
    },
  })
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ contact })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, contactId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = await req.json()
  const data: Prisma.NativeContactUpdateInput = {}
  if (body.firstName !== undefined) data.firstName = body.firstName
  if (body.lastName !== undefined) data.lastName = body.lastName
  if (body.email !== undefined) data.email = normalizeEmail(body.email)
  if (body.phone !== undefined) data.phone = normalizePhone(body.phone)
  if (body.tags !== undefined) data.tags = body.tags
  if (body.source !== undefined) data.source = body.source
  if (body.assignedToUserId !== undefined) data.assignedToUserId = body.assignedToUserId
  if (body.customFields !== undefined) {
    data.customFields = body.customFields
      ? (body.customFields as Prisma.InputJsonValue)
      : Prisma.JsonNull
  }

  // Scope by workspaceId so a stolen id from another tenant can't mutate.
  const result = await db.nativeContact.updateMany({
    where: { id: contactId, workspaceId },
    data,
  })
  if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const contact = await db.nativeContact.findUnique({ where: { id: contactId } })
  return NextResponse.json({ contact })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, contactId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const result = await db.nativeContact.deleteMany({
    where: { id: contactId, workspaceId },
  })
  if (result.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
