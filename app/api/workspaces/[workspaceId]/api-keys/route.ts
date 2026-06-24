import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { generateApiKey } from '@/lib/api-key'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const keys = await db.apiKey.findMany({
    where: { workspaceId, scope: 'workspace' },
    select: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      revokedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ keys })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  if (access.role !== 'owner' && access.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { name } = body
  if (!name || typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'name required' }, { status: 422 })
  }

  const { raw, prefix, hashed } = generateApiKey()
  await db.apiKey.create({
    data: {
      workspaceId,
      scope: 'workspace',
      name: name.trim(),
      prefix,
      hashedKey: hashed,
      createdByUserId: access.session.user.id,
    },
  })

  // raw is returned ONCE here and never stored — only the hashed value persists
  return NextResponse.json({ key: raw, prefix }, { status: 201 })
}
