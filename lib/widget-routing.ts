/**
 * Widget conversation routing engine.
 *
 * When a chat needs a human — AI handover, manual takeover request,
 * unassigned chat sitting in the queue — this picks which workspace
 * member it lands on, writes the assignment, broadcasts a SSE event so
 * any open inbox tab updates live, and (optionally) fires a personal
 * notification to the assignee.
 *
 * Modes (configured per ChatWidget.routingMode):
 *
 *  - "manual": no auto-pick. The chat sits in the unassigned queue
 *    until an operator claims it from the inbox (or a manual reply
 *    self-assigns).
 *  - "round_robin": cycle through eligible *available* members in
 *    deterministic order, using ChatWidget.routingLastAssignedUserId
 *    as the cursor so the next chat goes to the next person.
 *  - "first_available": pick the available member with the fewest open
 *    chats. Smooths load when one operator is buried.
 *
 * Eligibility: ChatWidget.routingTargetUserIds (workspace member user
 * IDs). Empty array = "everyone in the workspace." Members with
 * isAvailable=false are skipped by both auto modes; manual assignment
 * still works on them so an operator can return-after-lunch and keep
 * the chat they had.
 */

import { db } from './db'
import { broadcast } from './widget-sse'
import { notify } from './notifications'
import { resolveHandoverLink } from './handover-link'

export type RoutingMode = 'manual' | 'round_robin' | 'first_available'
export type AssignmentReason = 'manual' | 'self' | 'round_robin' | 'first_available' | 'handover'

interface CandidateMember {
  userId: string
  isAvailable: boolean
  user: { name: string | null; email: string | null }
}

/**
 * Candidate list = workspace members whose userId is in
 * widget.routingTargetUserIds (or all members if that array is empty).
 * Doesn't filter on availability — that's the picker's job, since
 * we want manual flows to see *everyone* even if they're away.
 */
async function loadCandidates(workspaceId: string, targetUserIds: string[]): Promise<CandidateMember[]> {
  const where: any = { workspaceId }
  if (targetUserIds.length > 0) where.userId = { in: targetUserIds }
  let rows: any[] = []
  try {
    rows = await db.workspaceMember.findMany({
      where,
      select: {
        userId: true,
        isAvailable: true,
        user: { select: { name: true, email: true } },
      },
    })
  } catch (err: any) {
    // Migration pending → no candidates, behave like manual mode.
    if (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')) {
      return []
    }
    throw err
  }
  return rows
    .filter(r => r.user)
    .map(r => ({ userId: r.userId, isAvailable: r.isAvailable !== false, user: r.user }))
}

/**
 * Decide which user (if any) should get the chat.
 * Returns null if mode is manual or no eligible/available candidate.
 */
export async function pickAssignee(params: {
  workspaceId: string
  widgetId: string
}): Promise<{ userId: string; reason: AssignmentReason } | null> {
  const widget = await db.chatWidget.findUnique({
    where: { id: params.widgetId },
    select: {
      routingMode: true,
      routingTargetUserIds: true,
      routingLastAssignedUserId: true,
    },
  }).catch(() => null)
  if (!widget) return null
  const mode = (widget.routingMode || 'manual') as RoutingMode
  if (mode === 'manual') return null

  const candidates = await loadCandidates(params.workspaceId, widget.routingTargetUserIds || [])
  const available = candidates.filter(c => c.isAvailable)
  if (available.length === 0) return null

  // Stable order so round-robin is deterministic across calls.
  available.sort((a, b) => a.userId.localeCompare(b.userId))

  if (mode === 'round_robin') {
    const lastIdx = widget.routingLastAssignedUserId
      ? available.findIndex(c => c.userId === widget.routingLastAssignedUserId)
      : -1
    const nextIdx = (lastIdx + 1) % available.length
    const pick = available[nextIdx]
    return { userId: pick.userId, reason: 'round_robin' }
  }

  if (mode === 'first_available') {
    // Open-chat counts per candidate — cap status to active/handed_off
    // since 'ended' chats don't represent ongoing load.
    const userIds = available.map(c => c.userId)
    const loads = await db.widgetConversation.groupBy({
      by: ['assignedUserId'],
      where: {
        assignedUserId: { in: userIds },
        status: { in: ['active', 'handed_off'] },
      },
      _count: { _all: true },
    }).catch(() => [] as any[])
    const loadByUser = new Map<string, number>()
    for (const row of loads) {
      if (row.assignedUserId) loadByUser.set(row.assignedUserId, row._count._all)
    }
    let pick = available[0]
    let pickLoad = loadByUser.get(pick.userId) ?? 0
    for (const c of available.slice(1)) {
      const load = loadByUser.get(c.userId) ?? 0
      if (load < pickLoad) { pick = c; pickLoad = load }
    }
    return { userId: pick.userId, reason: 'first_available' }
  }

  return null
}

/**
 * Assign a conversation to a user. Idempotent — re-assigning to the same
 * user is a no-op. Updates the widget's round-robin cursor when a routing
 * mode picked the assignee. Broadcasts SSE + sends a personal
 * notification to the new assignee unless skipped.
 */
export async function assignConversation(params: {
  workspaceId: string
  conversationId: string
  userId: string | null
  reason: AssignmentReason
  notifyAssignee?: boolean
}): Promise<void> {
  const { workspaceId, conversationId, userId, reason } = params

  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widget: { workspaceId } },
    select: {
      id: true, widgetId: true, assignedUserId: true,
      widget: { select: { name: true } },
    },
  })
  if (!convo) return
  if (convo.assignedUserId === userId) return

  await db.widgetConversation.update({
    where: { id: conversationId },
    data: {
      assignedUserId: userId,
      assignedAt: userId ? new Date() : null,
      assignmentReason: userId ? reason : null,
    },
  })

  // Round-robin cursor update so the *next* call hands off to whoever
  // comes after this user in the rotation.
  if (userId && (reason === 'round_robin' || reason === 'first_available')) {
    await db.chatWidget.update({
      where: { id: convo.widgetId },
      data: { routingLastAssignedUserId: userId },
    }).catch(() => {})
  }

  let assigneeName: string | null = null
  if (userId) {
    const u = await db.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    }).catch(() => null)
    assigneeName = u?.name ?? u?.email ?? null
  }

  await broadcast(conversationId, {
    type: 'assignment_changed',
    assignedUserId: userId,
    assigneeName,
    reason: userId ? reason : null,
    at: new Date().toISOString(),
  })

  if (userId && params.notifyAssignee !== false) {
    try {
      const link = resolveHandoverLink({
        workspaceId,
        locationId: `widget:${convo.widgetId}`,
        conversationId,
        channel: 'Live_Chat',
      })
      await notify({
        workspaceId,
        event: 'widget.conversation_assigned',
        title: `New chat assigned to you on ${convo.widget.name || 'your widget'}`,
        body: reasonBody(reason),
        link,
        severity: 'info',
        targetUserId: userId,
      })
    } catch (err: any) {
      console.warn('[widget-routing] assignment notify failed:', err.message)
    }
  }
}

function reasonBody(reason: AssignmentReason): string {
  switch (reason) {
    case 'manual':           return 'A teammate assigned this chat to you.'
    case 'self':             return 'You replied — the chat is now yours.'
    case 'round_robin':      return 'Round-robin routing landed this chat with you.'
    case 'first_available':  return 'You had the lightest queue — picking up this chat.'
    case 'handover':         return 'The AI agent handed off — please take over.'
  }
}

/**
 * Convenience: route an unassigned conversation per its widget config.
 * No-op if already assigned. Used at handover time and on first-touch.
 */
export async function autoRouteIfUnassigned(params: {
  workspaceId: string
  conversationId: string
}): Promise<{ assigned: boolean; userId?: string }> {
  const convo = await db.widgetConversation.findFirst({
    where: { id: params.conversationId, widget: { workspaceId: params.workspaceId } },
    select: { id: true, widgetId: true, assignedUserId: true },
  })
  if (!convo) return { assigned: false }
  if (convo.assignedUserId) return { assigned: true, userId: convo.assignedUserId }

  const pick = await pickAssignee({ workspaceId: params.workspaceId, widgetId: convo.widgetId })
  if (!pick) return { assigned: false }

  await assignConversation({
    workspaceId: params.workspaceId,
    conversationId: convo.id,
    userId: pick.userId,
    reason: pick.reason,
  })
  return { assigned: true, userId: pick.userId }
}
