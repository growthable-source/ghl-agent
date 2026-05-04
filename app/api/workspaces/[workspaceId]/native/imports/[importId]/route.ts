import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; importId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, importId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const job = await db.nativeContactImport.findFirst({
    where: { id: importId, workspaceId },
    include: {
      errorRows: { orderBy: { rowNumber: 'asc' }, take: 500 },
      list: { select: { id: true, name: true } },
    },
  })
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ import: job })
}
