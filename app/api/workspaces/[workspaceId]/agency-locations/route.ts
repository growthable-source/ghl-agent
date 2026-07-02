import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'

type Params = { params: Promise<{ workspaceId: string }> }

const PAGE_SIZE = 50

/**
 * GET /api/workspaces/:id/agency-locations?q=&filter=all|on|off&page=1
 * Location list for the per-location widget toggle. Member+ can view.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceRole(workspaceId, 'member')
  if (access instanceof NextResponse) return access

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  const filter = req.nextUrl.searchParams.get('filter') ?? 'all'
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10) || 1)

  const connection = await db.agencyConnection.findFirst({
    where: { workspaceId },
    select: { id: true, companyId: true, tokenRefreshFailedAt: true, updatedAt: true },
  })
  if (!connection) return NextResponse.json({ connected: false, locations: [], total: 0 })

  const where = {
    connectionId: connection.id,
    removedAt: null,
    ...(filter === 'on' ? { widgetEnabled: true } : filter === 'off' ? { widgetEnabled: false } : {}),
    ...(q ? {
      OR: [
        { name: { contains: q, mode: 'insensitive' as const } },
        { email: { contains: q, mode: 'insensitive' as const } },
        { city: { contains: q, mode: 'insensitive' as const } },
        { locationId: { contains: q } },
      ],
    } : {}),
  }

  const [total, enabledCount, locations, lastSynced] = await Promise.all([
    db.agencyLocation.count({ where }),
    db.agencyLocation.count({ where: { connectionId: connection.id, removedAt: null, widgetEnabled: true } }),
    db.agencyLocation.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, locationId: true, name: true, city: true, state: true,
        country: true, email: true, phone: true, widgetEnabled: true,
        widgetEnabledUpdatedAt: true, lastSyncedAt: true,
      },
    }),
    db.agencyLocation.aggregate({
      where: { connectionId: connection.id },
      _max: { lastSyncedAt: true },
    }),
  ])

  return NextResponse.json({
    connected: true,
    needsReconnect: !!connection.tokenRefreshFailedAt,
    locations,
    total,
    enabledCount,
    page,
    pageSize: PAGE_SIZE,
    lastSyncedAt: lastSynced._max.lastSyncedAt,
  })
}

/**
 * PATCH /api/workspaces/:id/agency-locations
 * Body: { locationIds: string[] (AgencyLocation.locationId), widgetEnabled: boolean }
 * Bulk + single toggle share this. Admin+ only.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceRole(workspaceId, 'admin')
  if (access instanceof NextResponse) return access

  const body = await req.json().catch(() => null)
  const locationIds: unknown = body?.locationIds
  const widgetEnabled: unknown = body?.widgetEnabled
  if (!Array.isArray(locationIds) || locationIds.length === 0 || locationIds.length > 500
      || !locationIds.every(id => typeof id === 'string') || typeof widgetEnabled !== 'boolean') {
    return NextResponse.json({ error: 'locationIds (1-500 strings) and widgetEnabled (boolean) required' }, { status: 400 })
  }

  const result = await db.agencyLocation.updateMany({
    where: {
      locationId: { in: locationIds },
      connection: { workspaceId },
    },
    data: {
      widgetEnabled,
      widgetEnabledUpdatedAt: new Date(),
      widgetEnabledUpdatedBy: `user:${access.session.user?.id ?? 'unknown'}`,
    },
  })
  return NextResponse.json({ updated: result.count })
}
