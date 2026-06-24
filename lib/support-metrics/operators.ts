import type { Db, MetricScope } from './types'

export async function getOperatorMetrics(db: Db, scope: MetricScope) {
  const members = await db.workspaceMember.findMany({
    where: { workspaceId: scope.workspaceId, role: { not: 'viewer' } },
    select: { userId: true, isAvailable: true, user: { select: { name: true, email: true, image: true } } },
  })
  const tickets = await db.ticket.groupBy({
    by: ['assignedUserId', 'status'],
    where: { workspaceId: scope.workspaceId, assignedUserId: { not: null }, createdAt: { gte: scope.from, lt: scope.to } },
    _count: { _all: true },
  })
  const openStatuses = new Set(['open', 'pending', 'on_hold'])
  return members.map((m) => {
    const mine = tickets.filter((t) => t.assignedUserId === m.userId)
    const assigned = mine.reduce((n, t) => n + t._count._all, 0)
    const open = mine.filter((t) => openStatuses.has(t.status)).reduce((n, t) => n + t._count._all, 0)
    return { userId: m.userId, name: m.user?.name ?? null, email: m.user?.email ?? null, image: m.user?.image ?? null, isAvailable: m.isAvailable, assigned, open }
  })
}
