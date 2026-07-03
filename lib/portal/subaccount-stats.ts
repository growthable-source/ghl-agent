/**
 * Portal Overview: CRM connection status + per-sub-account activity +
 * top support consumers. Everything here is best-effort — each query
 * catches to an empty result so the Overview renders on un-migrated DBs
 * (locationId column / AgencyConnection tables may not exist yet).
 */

import { db } from '@/lib/db'

export interface ConnectionSummary {
  widgetId: string
  widgetName: string
  companyName: string | null
  companyId: string
  totalLocations: number
  enabledLocations: number
}

export interface LocationChatCount {
  locationId: string
  name: string | null
  count: number
}

export interface TopConsumer {
  visitorId: string
  name: string | null
  email: string | null
  conversations: number
  messages: number
}

/** Active agency connections across the portal's widgets. */
export async function getConnectionSummaries(widgetIds: string[]): Promise<ConnectionSummary[]> {
  if (widgetIds.length === 0) return []
  try {
    const conns = await db.agencyConnection.findMany({
      where: { widgetId: { in: widgetIds }, NOT: { accessToken: '' } },
      select: {
        widgetId: true,
        companyId: true,
        companyName: true,
        widget: { select: { name: true } },
        _count: { select: { locations: { where: { removedAt: null } } } },
      },
    })
    if (conns.length === 0) return []
    const enabled = await db.agencyLocation.groupBy({
      by: ['connectionId'],
      where: { connection: { widgetId: { in: widgetIds } }, removedAt: null, widgetEnabled: true },
      _count: { _all: true },
    }).catch(() => [])
    // groupBy is keyed by connectionId; re-fetch the id → widget mapping
    // cheaply via a second lookup keyed the same way.
    const connRows = await db.agencyConnection.findMany({
      where: { widgetId: { in: widgetIds } },
      select: { id: true, widgetId: true },
    })
    const connToWidget = new Map(connRows.map(c => [c.id, c.widgetId]))
    const enabledByWidget = new Map<string, number>()
    for (const g of enabled) {
      const wid = connToWidget.get(g.connectionId)
      if (wid) enabledByWidget.set(wid, (g._count?._all ?? 0))
    }
    return conns.map(c => ({
      widgetId: c.widgetId,
      widgetName: c.widget.name,
      companyName: c.companyName ?? null,
      companyId: c.companyId,
      totalLocations: c._count.locations,
      enabledLocations: enabledByWidget.get(c.widgetId) ?? 0,
    }))
  } catch {
    return []
  }
}

/**
 * Chats per sub-account over the window. Forward-only: attribution
 * starts when embeds began stamping locationId; also returns how many
 * conversations in the window carry no location so the panel can be
 * honest about coverage.
 */
export async function getChatsPerLocation(
  widgetIds: string[],
  since: Date,
): Promise<{ rows: LocationChatCount[]; unattributed: number }> {
  if (widgetIds.length === 0) return { rows: [], unattributed: 0 }
  try {
    const [groups, unattributed] = await Promise.all([
      db.widgetConversation.groupBy({
        by: ['locationId'],
        where: { widgetId: { in: widgetIds }, createdAt: { gte: since }, locationId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { locationId: 'desc' } },
        take: 8,
      }),
      db.widgetConversation.count({
        where: { widgetId: { in: widgetIds }, createdAt: { gte: since }, locationId: null },
      }),
    ])
    const ids = groups.map(g => g.locationId).filter((v): v is string => !!v)
    const named = ids.length
      ? await db.agencyLocation.findMany({
          where: { locationId: { in: ids }, connection: { widgetId: { in: widgetIds } } },
          select: { locationId: true, name: true },
        }).catch(() => [])
      : []
    const nameByLoc = new Map(named.map(l => [l.locationId, l.name]))
    return {
      rows: groups
        .filter((g): g is typeof g & { locationId: string } => !!g.locationId)
        .map(g => ({
          locationId: g.locationId,
          name: nameByLoc.get(g.locationId) ?? null,
          count: g._count._all,
        })),
      unattributed,
    }
  } catch {
    return { rows: [], unattributed: 0 }
  }
}

/** Visitors generating the most support load in the window. */
export async function getTopConsumers(widgetIds: string[], since: Date): Promise<TopConsumer[]> {
  if (widgetIds.length === 0) return []
  try {
    const groups = await db.widgetConversation.groupBy({
      by: ['visitorId'],
      where: { widgetId: { in: widgetIds }, createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { visitorId: 'desc' } },
      take: 8,
    })
    if (groups.length === 0) return []
    const visitorIds = groups.map(g => g.visitorId)
    const [visitors, convs] = await Promise.all([
      db.widgetVisitor.findMany({
        where: { id: { in: visitorIds } },
        select: { id: true, name: true, email: true },
      }),
      db.widgetConversation.findMany({
        where: { visitorId: { in: visitorIds }, createdAt: { gte: since } },
        select: { visitorId: true, _count: { select: { messages: true } } },
      }),
    ])
    const vById = new Map(visitors.map(v => [v.id, v]))
    const msgByVisitor = new Map<string, number>()
    for (const c of convs) {
      msgByVisitor.set(c.visitorId, (msgByVisitor.get(c.visitorId) ?? 0) + c._count.messages)
    }
    return groups.map(g => ({
      visitorId: g.visitorId,
      name: vById.get(g.visitorId)?.name ?? null,
      email: vById.get(g.visitorId)?.email ?? null,
      conversations: g._count._all,
      messages: msgByVisitor.get(g.visitorId) ?? 0,
    }))
  } catch {
    return []
  }
}
