import type { Db, MetricScope } from './types'

type MsgLite = { direction: string; createdAt: Date }
type TicketLite = { createdAt: Date; messages: MsgLite[]; assignedAt: Date | null }

export function firstResponseMins(t: TicketLite): number | null {
  const firstOut = t.messages
    .filter((m) => m.direction === 'outbound')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]
  const anchor = firstOut?.createdAt ?? t.assignedAt
  if (!anchor) return null
  return Math.round((anchor.getTime() - t.createdAt.getTime()) / 60000)
}

export function resolutionMins(t: { createdAt: Date; closedAt: Date | null }): number | null {
  if (!t.closedAt) return null
  return Math.round((t.closedAt.getTime() - t.createdAt.getTime()) / 60000)
}

export function attainment(values: number[], targetMins: number | null): number | null {
  if (targetMins == null || values.length === 0) return null
  const met = values.filter((v) => v <= targetMins).length
  return Math.round((met / values.length) * 100)
}

type PolicyTarget = { firstResponseMins: number | null; resolutionMins: number | null }
type PolicyMap = Map<string, PolicyTarget>

function targetFor(map: PolicyMap, priority: string, field: 'firstResponseMins' | 'resolutionMins'): number | null {
  return (map.get(priority) ?? map.get('default'))?.[field] ?? null
}

/**
 * SLA attainment for tickets created in the window. Returns null fields when no
 * policy targets exist so the dashboard shows "not tracked" rather than a fake 100%.
 */
export async function getSlaMetrics(db: Db, scope: MetricScope) {
  const policies = await db.slaPolicy.findMany({ where: { workspaceId: scope.workspaceId, enabled: true } })
  const map: PolicyMap = new Map(
    policies.map((p) => [p.priority, { firstResponseMins: p.firstResponseMins, resolutionMins: p.resolutionMins }])
  )

  const where: Record<string, unknown> = {
    workspaceId: scope.workspaceId,
    createdAt: { gte: scope.from, lt: scope.to },
  }
  if (scope.brandId === 'no_brand') where.brandId = null
  else if (scope.brandId) where.brandId = scope.brandId

  const tickets = await db.ticket.findMany({
    where,
    select: {
      priority: true,
      createdAt: true,
      closedAt: true,
      assignedAt: true,
      messages: { select: { direction: true, createdAt: true } },
    },
  })

  const frByPriority = new Map<string, number[]>()
  const resByPriority = new Map<string, number[]>()
  for (const t of tickets) {
    const fr = firstResponseMins(t)
    if (fr != null && targetFor(map, t.priority, 'firstResponseMins') != null) {
      if (!frByPriority.has(t.priority)) frByPriority.set(t.priority, [])
      frByPriority.get(t.priority)!.push(fr)
    }
    const res = resolutionMins(t)
    if (res != null && targetFor(map, t.priority, 'resolutionMins') != null) {
      if (!resByPriority.has(t.priority)) resByPriority.set(t.priority, [])
      resByPriority.get(t.priority)!.push(res)
    }
  }

  const flat = (m: Map<string, number[]>) => [...m.values()].flat()
  const allFr = flat(frByPriority)
  const allRes = flat(resByPriority)
  // overall attainment compares each value to its own priority target
  const frMet = [...frByPriority.entries()].reduce(
    (n, [p, vals]) => n + vals.filter((v) => v <= targetFor(map, p, 'firstResponseMins')!).length, 0)
  const resMet = [...resByPriority.entries()].reduce(
    (n, [p, vals]) => n + vals.filter((v) => v <= targetFor(map, p, 'resolutionMins')!).length, 0)

  const byPriority = ['urgent', 'high', 'normal', 'low'].map((priority) => ({
    priority,
    firstResponseAttainment: attainment(frByPriority.get(priority) ?? [], targetFor(map, priority, 'firstResponseMins')),
    resolutionAttainment: attainment(resByPriority.get(priority) ?? [], targetFor(map, priority, 'resolutionMins')),
  }))

  return {
    tracked: map.size > 0,
    firstResponseAttainment: allFr.length ? Math.round((frMet / allFr.length) * 100) : null,
    resolutionAttainment: allRes.length ? Math.round((resMet / allRes.length) * 100) : null,
    firstResponseBreaches: allFr.length - frMet,
    resolutionBreaches: allRes.length - resMet,
    byPriority,
  }
}

/** Tickets that breached either target, for the /sla/breaches drill-down. */
export async function listSlaBreaches(db: Db, scope: MetricScope, limit = 100) {
  const policies = await db.slaPolicy.findMany({ where: { workspaceId: scope.workspaceId, enabled: true } })
  const map: PolicyMap = new Map(
    policies.map((p) => [p.priority, { firstResponseMins: p.firstResponseMins, resolutionMins: p.resolutionMins }])
  )
  const where: Record<string, unknown> = { workspaceId: scope.workspaceId, createdAt: { gte: scope.from, lt: scope.to } }
  if (scope.brandId === 'no_brand') where.brandId = null
  else if (scope.brandId) where.brandId = scope.brandId

  const tickets = await db.ticket.findMany({
    where,
    select: {
      id: true, ticketNumber: true, subject: true, priority: true, status: true,
      createdAt: true, closedAt: true, assignedAt: true,
      messages: { select: { direction: true, createdAt: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  const breaches = []
  for (const t of tickets) {
    const fr = firstResponseMins(t)
    const res = resolutionMins(t)
    const frTarget = targetFor(map, t.priority, 'firstResponseMins')
    const resTarget = targetFor(map, t.priority, 'resolutionMins')
    const frBreach = fr != null && frTarget != null && fr > frTarget
    const resBreach = res != null && resTarget != null && res > resTarget
    if (frBreach || resBreach) {
      breaches.push({
        id: t.id, ticketNumber: t.ticketNumber, subject: t.subject, priority: t.priority, status: t.status,
        firstResponseMins: fr, firstResponseTarget: frTarget, firstResponseBreached: frBreach,
        resolutionMins: res, resolutionTarget: resTarget, resolutionBreached: resBreach,
      })
    }
    if (breaches.length >= limit) break
  }
  return breaches
}
