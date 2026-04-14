import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

export async function GET(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const limit = parseInt(searchParams.get('limit') ?? '25')
  const skip = (page - 1) * limit

  // Get all locationIds for this workspace
  const locations = await db.location.findMany({
    where: { workspaceId },
    select: { id: true },
  })
  const locationIds = locations.map(l => l.id)

  const [logs, total] = await Promise.all([
    db.messageLog.findMany({
      where: { locationId: { in: locationIds } },
      include: { agent: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    db.messageLog.count({ where: { locationId: { in: locationIds } } }),
  ])

  return NextResponse.json({ logs, total, page, limit, pages: Math.ceil(total / limit) })
}
