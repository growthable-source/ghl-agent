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
import { getLiveChatSettings } from './livechat-settings'
import { estimateWaitSecs } from './queue-estimate'

export type RoutingMode = 'manual' | 'round_robin' | 'first_available'
export type AssignmentReason = 'manual' | 'self' | 'round_robin' | 'first_available' | 'handover'

interface CandidateMember {
  userId: string
  isAvailable: boolean
  user: { name: string | null; email: string | null }
}

// Roles that can NOT work a live chat — never auto-route to them even
// if an operator accidentally added them to routingTargetUserIds.
// Viewers are read-only; routing a chat to one would strand it with
// nobody able to reply. (Mirrors the viewer exclusion in the widget
// editor's eligible-teammates picker.)
const NON_CHAT_ROLES = new Set(['viewer'])

/**
 * Candidate list = workspace members whose userId is in
 * widget.routingTargetUserIds (or all members if that array is empty).
 * Doesn't filter on availability — that's the picker's job, since
 * we want manual flows to see *everyone* even if they're away. DOES
 * filter out roles that can't reply (viewer) so the router never lands
 * a chat on someone the product won't let answer it.
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
        role: true,
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
    .filter(r => r.user && !NON_CHAT_ROLES.has(r.role))
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
      id: true, widgetId: true, assignedUserId: true, queuedAt: true,
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
      // A human now owns it — it leaves the queue.
      ...(userId ? { queuedAt: null } : {}),
    },
  })

  // If this chat was waiting in the queue, the line just shifted — push
  // fresh positions to everyone still queued.
  if (userId && convo.queuedAt) {
    await broadcastQueuePositions(workspaceId).catch(() => {})
  }

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
}): Promise<{ assigned: boolean; userId?: string; queued?: boolean }> {
  const convo = await db.widgetConversation.findFirst({
    where: { id: params.conversationId, widget: { workspaceId: params.workspaceId } },
    select: { id: true, widgetId: true, assignedUserId: true },
  })
  if (!convo) return { assigned: false }
  if (convo.assignedUserId) return { assigned: true, userId: convo.assignedUserId }

  // Capacity/queue gate (when enabled). Full team or nobody available →
  // wait in the queue rather than sitting silently unassigned.
  const settings = await getLiveChatSettings(params.workspaceId)
  if (settings.queueEnabled) {
    const live = await countLiveHumanChats(params.workspaceId)
    if (live < settings.maxConcurrentHumanChats) {
      const pick = await pickAssignee({ workspaceId: params.workspaceId, widgetId: convo.widgetId })
      if (pick) {
        await assignConversation({ workspaceId: params.workspaceId, conversationId: convo.id, userId: pick.userId, reason: pick.reason })
        return { assigned: true, userId: pick.userId }
      }
    }
    await enqueueConversation(params.workspaceId, convo.id)
    return { assigned: false, queued: true }
  }

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

/**
 * Resolve the human a chat should fall back to when normal routing
 * finds nobody (manual mode, or everyone away): the widget's configured
 * fallback owner if it's still a valid non-viewer member, else the
 * workspace owner. Returns null only when the workspace has no usable
 * owner at all.
 */
async function resolveFallbackAssignee(workspaceId: string, fallbackUserId: string | null): Promise<string | null> {
  if (fallbackUserId) {
    const m = await db.workspaceMember.findFirst({
      where: { workspaceId, userId: fallbackUserId },
      select: { userId: true, role: true },
    }).catch(() => null)
    if (m && !NON_CHAT_ROLES.has(m.role)) return m.userId
  }
  const owner = await db.workspaceMember.findFirst({
    where: { workspaceId, role: 'owner' },
    select: { userId: true },
    orderBy: { createdAt: 'asc' },
  }).catch(() => null)
  return owner?.userId ?? null
}

/**
 * Force a conversation onto a human — used when the customer EXPLICITLY
 * asks for one (the AI's transfer_to_human). Unlike autoRouteIfUnassigned,
 * this never leaves the chat ownerless: if routing picks nobody (manual
 * mode or all away), it force-assigns the fallback owner. No-op if the
 * chat is already assigned.
 */
export async function forceAssignToHuman(params: {
  workspaceId: string
  conversationId: string
}): Promise<{ assigned: boolean; userId?: string; viaFallback?: boolean; queued?: boolean }> {
  const convo = await db.widgetConversation.findFirst({
    where: { id: params.conversationId, widget: { workspaceId: params.workspaceId } },
    select: {
      id: true, widgetId: true, assignedUserId: true,
      widget: { select: { routingFallbackUserId: true } },
    },
  })
  if (!convo) return { assigned: false }
  if (convo.assignedUserId) return { assigned: true, userId: convo.assignedUserId }

  // Capacity/queue gate (when enabled). At capacity (or nobody available)
  // the chat WAITS in the queue instead of force-assigning the fallback
  // owner — and the AI keeps helping in the meantime.
  const settings = await getLiveChatSettings(params.workspaceId)
  if (settings.queueEnabled) {
    const live = await countLiveHumanChats(params.workspaceId)
    if (live < settings.maxConcurrentHumanChats) {
      const pick = await pickAssignee({ workspaceId: params.workspaceId, widgetId: convo.widgetId })
      if (pick) {
        await assignConversation({ workspaceId: params.workspaceId, conversationId: convo.id, userId: pick.userId, reason: pick.reason })
        return { assigned: true, userId: pick.userId }
      }
    }
    await enqueueConversation(params.workspaceId, convo.id)
    return { assigned: false, queued: true }
  }

  // Queue off — wave-1 behaviour: normal routing first (respects
  // round-robin / first-available).
  const pick = await pickAssignee({ workspaceId: params.workspaceId, widgetId: convo.widgetId })
  let userId = pick?.userId ?? null
  let viaFallback = false

  // Nobody from routing → fallback owner so it's never left ownerless.
  if (!userId) {
    userId = await resolveFallbackAssignee(params.workspaceId, convo.widget.routingFallbackUserId ?? null)
    viaFallback = true
  }
  if (!userId) return { assigned: false }

  await assignConversation({
    workspaceId: params.workspaceId,
    conversationId: convo.id,
    userId,
    reason: pick?.reason ?? 'handover',
  })
  return { assigned: true, userId, viaFallback }
}

// ─── Queue (workspace-total capacity) ───────────────────────────────

const QUEUE_STATUSES_OPEN = ['active', 'handed_off'] as const
/** Bounds for the data-derived average handle time (seconds). */
const HANDLE_SECS_MIN = 60
const HANDLE_SECS_MAX = 1800
const HANDLE_SECS_DEFAULT = 240

/** Live HUMAN chats across the workspace right now (assigned + not ended).
 *  AI-only chats don't consume human capacity. */
export async function countLiveHumanChats(workspaceId: string): Promise<number> {
  return db.widgetConversation.count({
    where: {
      widget: { workspaceId },
      assignedUserId: { not: null },
      status: { in: QUEUE_STATUSES_OPEN as unknown as string[] },
    },
  }).catch(() => 0)
}

/** Average human handle time from recent ended, human-handled chats —
 *  (lastMessageAt − assignedAt), clamped, with a sane default when there
 *  isn't enough history yet. Feeds the visitor wait estimate. */
async function getAvgHandleSecs(workspaceId: string): Promise<number> {
  try {
    const recent = await db.widgetConversation.findMany({
      where: { widget: { workspaceId }, status: 'ended', assignedUserId: { not: null }, assignedAt: { not: null } },
      select: { assignedAt: true, lastMessageAt: true },
      orderBy: { lastMessageAt: 'desc' },
      take: 30,
    })
    const durs = recent
      .map(c => (c.assignedAt ? (c.lastMessageAt.getTime() - c.assignedAt.getTime()) / 1000 : 0))
      .filter(s => s > 0)
    if (durs.length === 0) return HANDLE_SECS_DEFAULT
    const avg = durs.reduce((a, b) => a + b, 0) / durs.length
    return Math.min(HANDLE_SECS_MAX, Math.max(HANDLE_SECS_MIN, Math.round(avg)))
  } catch {
    return HANDLE_SECS_DEFAULT
  }
}

/** All conversations waiting in the human queue, oldest first. */
async function listQueued(workspaceId: string): Promise<Array<{ id: string; widgetId: string }>> {
  return db.widgetConversation.findMany({
    where: { widget: { workspaceId }, queuedAt: { not: null }, assignedUserId: null, status: { not: 'ended' } },
    select: { id: true, widgetId: true },
    orderBy: { queuedAt: 'asc' },
  }).catch(() => [])
}

/** Push fresh queue positions + wait estimates to every waiting visitor. */
async function broadcastQueuePositions(workspaceId: string): Promise<void> {
  const [settings, queued, avg] = await Promise.all([
    getLiveChatSettings(workspaceId),
    listQueued(workspaceId),
    getAvgHandleSecs(workspaceId),
  ])
  for (let i = 0; i < queued.length; i++) {
    const position = i + 1
    await broadcast(queued[i].id, {
      type: 'queue_update',
      position,
      estimatedWaitSecs: estimateWaitSecs(position, settings.maxConcurrentHumanChats, avg),
      max: settings.maxConcurrentHumanChats,
    }).catch(() => {})
  }
}

/** Put a conversation into the queue (idempotent), keep the AI helping
 *  while it waits, and refresh everyone's position. */
async function enqueueConversation(workspaceId: string, conversationId: string): Promise<void> {
  const existing = await db.widgetConversation.findUnique({
    where: { id: conversationId },
    select: { queuedAt: true },
  }).catch(() => null)
  if (!existing?.queuedAt) {
    await db.widgetConversation.update({ where: { id: conversationId }, data: { queuedAt: new Date() } }).catch(() => {})
  }
  // AI keeps helping while queued — undo any handoff pause for this chat.
  await db.conversationStateRecord.updateMany({
    where: { conversationId, state: 'PAUSED' },
    data: { state: 'ACTIVE', pauseReason: null, resumedAt: new Date() },
  }).catch(() => {})
  await broadcastQueuePositions(workspaceId)
}

/** Pull from the front of the queue while the workspace has human
 *  capacity AND an available agent. Called when a slot frees (a chat
 *  ends) or an agent comes online, plus a cron backstop. */
export async function advanceQueue(workspaceId: string): Promise<{ assigned: number }> {
  const settings = await getLiveChatSettings(workspaceId)
  if (!settings.queueEnabled) return { assigned: 0 }

  let assigned = 0
  let guard = 50
  while (guard-- > 0) {
    const live = await countLiveHumanChats(workspaceId)
    if (live >= settings.maxConcurrentHumanChats) break
    const next = await db.widgetConversation.findFirst({
      where: { widget: { workspaceId }, queuedAt: { not: null }, assignedUserId: null, status: { not: 'ended' } },
      select: { id: true, widgetId: true },
      orderBy: { queuedAt: 'asc' },
    }).catch(() => null)
    if (!next) break
    const pick = await pickAssignee({ workspaceId, widgetId: next.widgetId })
    if (!pick) break // headroom but nobody available — leave it queued
    await assignConversation({ workspaceId, conversationId: next.id, userId: pick.userId, reason: pick.reason })
    assigned++
  }
  await broadcastQueuePositions(workspaceId)
  return { assigned }
}
