import type { Db, MetricScope } from './types'
import { getTicketMetrics } from './tickets'
import { getCsatMetrics } from './csat'
import { getSlaMetrics } from './sla'
import { getQueueSnapshot } from './queue'

export async function getWorkspaceOverview(db: Db, scope: MetricScope) {
  const [tickets, csat, sla, queue] = await Promise.all([
    getTicketMetrics(db, scope),
    getCsatMetrics(db, scope),
    getSlaMetrics(db, scope),
    getQueueSnapshot(db, scope.workspaceId),
  ])
  return {
    tickets: {
      open: tickets.scorecards.open,
      created: tickets.scorecards.created,
      closed: tickets.scorecards.closed,
      avgResolutionHours: tickets.scorecards.avgResolutionHours,
    },
    csat: {
      avgRating: csat.scorecards.avgRating,
      responseRate: csat.scorecards.responseRate,
      totalRated: csat.scorecards.totalRated,
    },
    sla: {
      tracked: sla.tracked,
      firstResponseAttainment: sla.firstResponseAttainment,
      resolutionAttainment: sla.resolutionAttainment,
    },
    queue,
  }
}

export async function getOrgOverview(db: Db, from: Date, to: Date) {
  const workspaces = await db.workspace.findMany({ select: { id: true, name: true } })
  const perWorkspace = await Promise.all(
    workspaces.map(async (w) => ({
      workspaceId: w.id,
      name: w.name,
      ...(await getWorkspaceOverview(db, { workspaceId: w.id, from, to })),
    }))
  )
  const totals = perWorkspace.reduce(
    (acc, w) => {
      acc.ticketsOpen += w.tickets.open
      acc.ticketsCreated += w.tickets.created
      acc.ticketsClosed += w.tickets.closed
      acc.queueDepth += w.queue.depth
      return acc
    },
    { ticketsOpen: 0, ticketsCreated: 0, ticketsClosed: 0, queueDepth: 0 }
  )
  return { totals, workspaces: perWorkspace }
}
