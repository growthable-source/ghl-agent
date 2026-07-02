/**
 * Portal → agency-location scoping.
 *
 * Portals are brand-scoped (PortalUserBrand). Locations hang off
 * workspace-level AgencyConnections. Bridge: the user's brands →
 * those brands' workspaces → those workspaces' connections. A portal
 * user may span workspaces if their brands do; that's intentional —
 * the portal is the agency's UI and the agency owns those locations.
 */

import { db } from '@/lib/db'
import type { PortalSession } from '@/lib/portal-auth'

export async function getPortalConnectionIds(session: PortalSession): Promise<string[]> {
  if (session.brandIds.length === 0) return []
  const brands = await db.brand.findMany({
    where: { id: { in: session.brandIds } },
    select: { workspaceId: true },
  })
  const workspaceIds = [...new Set(brands.map(b => b.workspaceId))]
  if (workspaceIds.length === 0) return []
  // .catch: AgencyConnection may not exist yet on un-migrated DBs (Ryan
  // hand-runs SQL after deploy). No table → no connections → empty state.
  const connections = await db.agencyConnection.findMany({
    where: { workspaceId: { in: workspaceIds } },
    select: { id: true },
  }).catch(() => [])
  return connections.map(c => c.id)
}
