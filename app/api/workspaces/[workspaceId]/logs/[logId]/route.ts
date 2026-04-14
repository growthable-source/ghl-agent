import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; logId: string }> }
) {
  const { workspaceId, logId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const log = await db.messageLog.findUnique({
    where: { id: logId },
    include: { agent: { select: { name: true } } },
  })
  if (!log) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ log })
}
