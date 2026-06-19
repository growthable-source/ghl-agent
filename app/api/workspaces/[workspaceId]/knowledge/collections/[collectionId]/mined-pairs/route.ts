import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; collectionId: string }> }

/**
 * GET — staged mined Q&A pairs for this collection. Defaults to pending;
 * pass ?status=approved|rejected|all to see others.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId, collectionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const statusParam = new URL(req.url).searchParams.get('status') ?? 'pending'
  const where: { collectionId: string; workspaceId: string; status?: string } = { collectionId, workspaceId }
  if (statusParam !== 'all') where.status = statusParam

  const pairs = await db.minedQaPair.findMany({
    where,
    orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
    take: 500,
  })
  return NextResponse.json({ pairs })
}
