import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:workspaceId/approvals
 * List messages awaiting human approval.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  const locationIds = locations.map(l => l.id)
  if (locationIds.length === 0) return NextResponse.json({ pending: [], recentDecided: [] })

  try {
    const pending = await db.messageLog.findMany({
      where: {
        locationId: { in: locationIds },
        needsApproval: true,
        approvalStatus: 'pending',
      },
      include: { agent: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })

    const recentDecided = await db.messageLog.findMany({
      where: {
        locationId: { in: locationIds },
        needsApproval: true,
        approvalStatus: { in: ['approved', 'rejected'] },
      },
      include: { agent: { select: { id: true, name: true } } },
      orderBy: { approvedAt: 'desc' },
      take: 30,
    })

    return NextResponse.json({ pending, recentDecided })
  } catch (err: any) {
    // Columns may not exist yet
    return NextResponse.json({ pending: [], recentDecided: [], notMigrated: true })
  }
}
