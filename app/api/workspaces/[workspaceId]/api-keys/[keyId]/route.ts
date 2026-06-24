import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; keyId: string }> }

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, keyId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  if (access.role !== 'owner' && access.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await db.apiKey.updateMany({
    where: { id: keyId, workspaceId },
    data: { revokedAt: new Date() },
  })

  return NextResponse.json({ ok: true })
}
