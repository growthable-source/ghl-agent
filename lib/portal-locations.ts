/**
 * Portal → agency-location scoping.
 *
 * Portals are brand-scoped (PortalUserBrand). Each AgencyConnection hangs
 * off ONE widget (one widget ↔ one agency), and each widget belongs to one
 * brand. A portal user sees ONLY the connections of widgets on their own
 * brands: brands → widgets → connections.
 *
 * NEVER widen this to the brand's WORKSPACE. A reseller workspace holds
 * many agencies' brands, each with its own widget and agency connection;
 * scoping by workspace showed every agency in it every other agency's
 * locations (names, emails, phones, cities) and let them toggle and
 * re-sync those rows (incident, 2026-11-04). The page header, the portal
 * Overview (lib/portal/subaccount-stats.ts) and the disconnect route all
 * scope by `widget.brandId`; this must match them.
 */

import { db } from '@/lib/db'
import type { PortalSession } from '@/lib/portal-auth'

/**
 * Prisma `where` for the AgencyConnections a portal user may see. Returns
 * null when the user has no brands: callers treat that as "no
 * connections" without querying, so an empty brand list can never turn
 * into an unfiltered query.
 */
export function portalConnectionWhere(brandIds: readonly string[]) {
  if (brandIds.length === 0) return null
  return { widget: { brandId: { in: [...brandIds] } } }
}

export async function getPortalConnectionIds(session: PortalSession): Promise<string[]> {
  const where = portalConnectionWhere(session.brandIds)
  if (!where) return []
  // .catch: AgencyConnection may not exist yet on un-migrated DBs (Ryan
  // hand-runs SQL after deploy). No table → no connections → empty state.
  const connections = await db.agencyConnection.findMany({
    where,
    select: { id: true },
  }).catch(() => [])
  return connections.map(c => c.id)
}
