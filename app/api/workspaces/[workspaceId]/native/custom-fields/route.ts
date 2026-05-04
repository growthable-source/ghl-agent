import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

const VALID_TYPES = ['text', 'number', 'date', 'select', 'multiselect', 'boolean', 'phone', 'email', 'url']

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const fields = await db.nativeCustomField.findMany({
    where: { workspaceId },
    orderBy: { position: 'asc' },
  })
  return NextResponse.json({ fields })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = await req.json()
  if (!body.name || !body.fieldKey || !body.dataType) {
    return NextResponse.json({ error: 'name, fieldKey, dataType required' }, { status: 400 })
  }
  if (!VALID_TYPES.includes(body.dataType)) {
    return NextResponse.json({ error: `dataType must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 })
  }
  // fieldKey must be safe for {{contact.<key>}} merge tags — snake_case only.
  const key = String(body.fieldKey).trim()
  if (!/^[a-z][a-z0-9_]*$/.test(key)) {
    return NextResponse.json({ error: 'fieldKey must be snake_case (a-z, 0-9, _, starting with a letter)' }, { status: 400 })
  }

  // Position auto-increments — caller doesn't have to manage it.
  const max = await db.nativeCustomField.aggregate({
    where: { workspaceId },
    _max: { position: true },
  })

  try {
    const field = await db.nativeCustomField.create({
      data: {
        workspaceId,
        name: String(body.name).trim(),
        fieldKey: key,
        dataType: body.dataType,
        options: body.options
          ? (body.options as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        placeholder: body.placeholder ?? null,
        position: (max._max.position ?? 0) + 1,
      },
    })
    return NextResponse.json({ field }, { status: 201 })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'fieldKey already exists in this workspace' }, { status: 409 })
    }
    throw err
  }
}
