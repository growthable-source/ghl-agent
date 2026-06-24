import type { Db } from './types'

export async function getQueueSnapshot(db: Db, workspaceId: string) {
  const settings = await db.liveChatSettings.findUnique({ where: { workspaceId } })
  const queued = await db.widgetConversation.findMany({
    where: { queuedAt: { not: null }, assignedUserId: null, status: { not: 'ended' }, widget: { workspaceId } },
    select: { queuedAt: true },
    orderBy: { queuedAt: 'asc' },
  })
  const available = await db.workspaceMember.count({ where: { workspaceId, isAvailable: true, role: { not: 'viewer' } } })
  const longestWaitSecs = queued.length && queued[0].queuedAt
    ? Math.round((Date.now() - queued[0].queuedAt.getTime()) / 1000)
    : 0
  return {
    depth: queued.length,
    availableAgents: available,
    maxConcurrentHumanChats: settings?.maxConcurrentHumanChats ?? null,
    queueEnabled: settings?.queueEnabled ?? false,
    longestWaitSecs,
  }
}
