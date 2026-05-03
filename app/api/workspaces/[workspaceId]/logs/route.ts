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
  // Optional filters. agentId scopes the rollup to a single agent (used
  // by per-agent Activity Overview); status filters by SUCCESS/SKIPPED/etc.
  const agentId = searchParams.get('agentId')
  const status = searchParams.get('status')

  // Get all locationIds for this workspace
  const locations = await db.location.findMany({
    where: { workspaceId },
    select: { id: true },
  })
  const locationIds = locations.map(l => l.id)

  const where: any = { locationId: { in: locationIds } }
  if (agentId) where.agentId = agentId
  if (status) where.status = status

  const [logs, total] = await Promise.all([
    db.messageLog.findMany({
      where,
      include: { agent: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    db.messageLog.count({ where }),
  ])

  return NextResponse.json({ logs, total, page, limit, pages: Math.ceil(total / limit) })
}
