import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'
import { getPortalConnectionIds } from '@/lib/portal-locations'

const PAGE_SIZE = 50

/**
 * GET /api/portal/locations?q=&filter=all|on|off&page=1
 * Agency-facing location list. Same response shape as the workspace
 * admin route so components/locations/LocationList works unchanged.
 */
export async function GET(req: NextRequest) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const connectionIds = await getPortalConnectionIds(session)
  if (connectionIds.length === 0) {
    return NextResponse.json({ connected: false, locations: [], total: 0 })
  }

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  const filter = req.nextUrl.searchParams.get('filter') ?? 'all'
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10) || 1)

  const where = {
    connectionId: { in: connectionIds },
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
    db.agencyLocation.count({ where: { connectionId: { in: connectionIds }, removedAt: null, widgetEnabled: true } }),
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
      where: { connectionId: { in: connectionIds } },
      _max: { lastSyncedAt: true },
    }),
  ])

  return NextResponse.json({
    connected: true, locations, total, enabledCount,
    page, pageSize: PAGE_SIZE, lastSyncedAt: lastSynced._max.lastSyncedAt,
  })
}

/**
 * PATCH /api/portal/locations
 * Body: { locationIds: string[], widgetEnabled: boolean }
 * Toggle scoped to the portal user's accessible connections.
 */
export async function PATCH(req: NextRequest) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const connectionIds = await getPortalConnectionIds(session)
  if (connectionIds.length === 0) return NextResponse.json({ error: 'No agency connection' }, { status: 404 })

  const body = await req.json().catch(() => null)
  const locationIds: unknown = body?.locationIds
  const widgetEnabled: unknown = body?.widgetEnabled
  if (!Array.isArray(locationIds) || locationIds.length === 0 || locationIds.length > 500
      || !locationIds.every(id => typeof id === 'string') || typeof widgetEnabled !== 'boolean') {
    return NextResponse.json({ error: 'locationIds (1-500 strings) and widgetEnabled (boolean) required' }, { status: 400 })
  }

  const result = await db.agencyLocation.updateMany({
    where: { locationId: { in: locationIds }, connectionId: { in: connectionIds } },
    data: {
      widgetEnabled,
      widgetEnabledUpdatedAt: new Date(),
      widgetEnabledUpdatedBy: `portal:${session.userId}`,
    },
  })
  return NextResponse.json({ updated: result.count })
}
