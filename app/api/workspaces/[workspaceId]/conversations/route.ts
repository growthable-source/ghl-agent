import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const { searchParams } = new URL(req.url)
  const state = searchParams.get('state')

  // Get all locationIds for this workspace
  const locations = await db.location.findMany({
    where: { workspaceId },
    select: { id: true },
  })
  const locationIds = locations.map(l => l.id)

  const conversations = await db.conversationStateRecord.findMany({
    where: {
      locationId: { in: locationIds },
      ...(state ? { state: state as 'ACTIVE' | 'PAUSED' | 'COMPLETED' } : {}),
    },
    orderBy: { updatedAt: 'desc' },
  })

  return NextResponse.json({ conversations })
}
