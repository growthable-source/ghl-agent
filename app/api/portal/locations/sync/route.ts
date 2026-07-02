import { NextResponse } from 'next/server'
import { getPortalSession } from '@/lib/portal-auth'
import { getPortalConnectionIds } from '@/lib/portal-locations'
import { syncAgencyLocations } from '@/lib/leadconnector-agency'

/** POST /api/portal/locations/sync — agency-triggered manual Refresh. */
export async function POST() {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const connectionIds = await getPortalConnectionIds(session)
  if (connectionIds.length === 0) return NextResponse.json({ error: 'No agency connection' }, { status: 404 })

  let total = 0, removed = 0
  for (const id of connectionIds) {
    try {
      const r = await syncAgencyLocations(id)
      total += r.total
      removed += r.removed
    } catch (err: any) {
      console.warn('[PortalLocations] sync failed for connection', id, err?.message)
    }
  }
  return NextResponse.json({ total, removed })
}
