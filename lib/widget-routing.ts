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
 * How many eligible agents are currently AVAILABLE for this widget
 * (in routingTargetUserIds — or everyone — , non-viewer, isAvailable=true).
 * Zero means "nobody is online to take a live chat right now," which is the
 * signal to show the visitor the wait experience (queue banner + ETA +
 * game) even when the capacity queue is turned off. Distinct from
 * pickAssignee returning null, which ALSO happens in manual mode while
 * operators are online — there we must NOT show the wait experience.
 */
export async function countAvailableAgents(workspaceId: string, widgetId: string): Promise<number> {
  const widget = await db.chatWidget.findUnique({
    where: { id: widgetId },
    select: { routingTargetUserIds: true },
  }).catch(() => null)
  if (!widget) return 0
  const candidates = await loadCandidates(workspaceId, widget.routingTargetUserIds || [])
  return candidates.filter(c => c.isAvailable).length
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
    select: { id: true, widgetId: true, assignedUserId: true, queuedAt: true },
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

  await emitAssignmentEffects({
    workspaceId,
    conversationId,
    widgetId: convo.widgetId,
    userId,
    reason,
    wasQueued: !!convo.queuedAt,
    notifyAssignee: params.notifyAssignee,
  })
}

/**
 * SSE + notification + bookkeeping that follow an assignment WRITE once it's
 * committed. Split out from the write itself so the capacity-gated path can
 * do its write inside a short advisory-locked transaction (see
 * claimSlotIfCapacity) and then run these slower, network-bound effects
 * off the lock — never pinning one of the few pooled connections while
 * broadcasting or notifying.
 */
async function emitAssignmentEffects(params: {
  workspaceId: string
  conversationId: string
  widgetId: string
  userId: string | null
  reason: AssignmentReason
  wasQueued: boolean
  notifyAssignee?: boolean
}): Promise<void> {
  const { workspaceId, conversationId, widgetId, userId, reason, wasQueued } = params

  // If this chat was waiting in the queue, the line just shifted — push
  // fresh positions to everyone still queued.
  if (userId && wasQueued) {
    await broadcastQueuePositions(workspaceId).catch(() => {})
  }

  // Round-robin cursor update so the *next* call hands off to whoever
  // comes after this user in the rotation.
  if (userId && (reason === 'round_robin' || reason === 'first_available')) {
    await db.chatWidget.update({
      where: { id: widgetId },
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
      const widget = await db.chatWidget.findUnique({
        where: { id: widgetId },
        select: { name: true },
      }).catch(() => null)
      const link = resolveHandoverLink({
        workspaceId,
        locationId: `widget:${widgetId}`,
        conversationId,
        channel: 'Live_Chat',
      })
      await notify({
        workspaceId,
        event: 'widget.conversation_assigned',
        title: `New chat assigned to you on ${widget?.name || 'your widget'}`,
        body: reasonBody(reason),
        link,
        severity: 'info',
        targetUserId: userId,
      })
    } catch (err) {
      console.warn('[widget-routing] assignment notify failed:', err instanceof Error ? err.message : String(err))
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
  // wait in the queue rather than sitting silently unassigned. The
  // capacity check + assignment are atomic (see assignWithinCapacity), so
  // concurrent handoffs can't push the workspace over its cap.
  const settings = await getLiveChatSettings(params.workspaceId)
  if (settings.queueEnabled) {
    const assignedTo = await assignWithinCapacity({
      workspaceId: params.workspaceId,
      conversationId: convo.id,
      widgetId: convo.widgetId,
      max: settings.maxConcurrentHumanChats,
    })
    if (assignedTo) return { assigned: true, userId: assignedTo.userId }
    await enqueueConversation(params.workspaceId, convo.id)
    return { assigned: false, queued: true }
  }

  // Queue off: assign if routing picks someone. But if NOBODY is online to
  // take it, fall into the queue anyway so the visitor gets the wait
  // experience (position + ETA + while-you-wait game) instead of silence —
  // the AI keeps helping meanwhile. Manual mode with operators online is
  // unaffected: pickAssignee returns null there, but availableCount > 0, so
  // the chat just sits in the unassigned inbox as before.
  const available = await countAvailableAgents(params.workspaceId, convo.widgetId)
  if (available === 0) {
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
  // owner — and the AI keeps helping in the meantime. The capacity check +
  // assignment are atomic (see assignWithinCapacity), so concurrent
  // handoffs can't push the workspace over its cap.
  const settings = await getLiveChatSettings(params.workspaceId)
  if (settings.queueEnabled) {
    const assignedTo = await assignWithinCapacity({
      workspaceId: params.workspaceId,
      conversationId: convo.id,
      widgetId: convo.widgetId,
      max: settings.maxConcurrentHumanChats,
    })
    if (assignedTo) return { assigned: true, userId: assignedTo.userId }
    await enqueueConversation(params.workspaceId, convo.id)
    return { assigned: false, queued: true }
  }

  // Queue off — but if NOBODY is online, don't force the chat onto an
  // offline owner: let the visitor wait with the queue experience (the AI
  // keeps helping) until someone comes online or the cron advances it.
  const available = await countAvailableAgents(params.workspaceId, convo.widgetId)
  if (available === 0) {
    await enqueueConversation(params.workspaceId, convo.id)
    return { assigned: false, queued: true }
  }

  // Someone IS available — wave-1 behaviour: normal routing first (respects
  // round-robin / first-available), then fallback owner so an explicit
  // human request is never left ownerless.
  const pick = await pickAssignee({ workspaceId: params.workspaceId, widgetId: convo.widgetId })
  let userId = pick?.userId ?? null
  let viaFallback = false

  // Nobody from routing (manual mode) → fallback owner.
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

// Namespace key for our per-workspace Postgres advisory locks (the first of
// the two int4 args to pg_advisory_xact_lock), chosen so it won't collide
// with advisory locks taken anywhere else. ASCII 'lvch'.
const QUEUE_LOCK_CLASS = 0x6c766368

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

/**
 * Atomically claim a human-capacity slot for `conversationId` and assign it
 * to `userId` — but ONLY if the workspace is below `max` live human chats and
 * the chat isn't already taken. This is the race-safe core of the capacity
 * gate: the count + the write run on a single connection inside a per-
 * workspace transaction advisory lock, so two concurrent callers (a handoff,
 * a presence toggle, the cron) can't both read `live < max` and both assign,
 * landing the workspace over cap. SSE/notify are deliberately NOT done here —
 * the caller runs them via emitAssignmentEffects once this returns, off the
 * lock. `SET LOCAL lock_timeout` means heavy same-workspace contention
 * degrades to "couldn't claim now" (caller queues / the cron retries) rather
 * than pinning one of the few pooled connections (lib/db.ts caps at 5).
 *
 * Returns whether the slot was claimed, plus whether the chat had been
 * sitting in the queue (so the caller knows to refresh queue positions).
 */
async function claimSlotIfCapacity(params: {
  workspaceId: string
  conversationId: string
  userId: string
  reason: AssignmentReason
  max: number
}): Promise<{ claimed: boolean; wasQueued: boolean }> {
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '3000ms'`
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${QUEUE_LOCK_CLASS}::int4, hashtext(${params.workspaceId})::int4)`

      const live = await tx.widgetConversation.count({
        where: {
          widget: { workspaceId: params.workspaceId },
          assignedUserId: { not: null },
          status: { in: QUEUE_STATUSES_OPEN as unknown as string[] },
        },
      })
      if (live >= params.max) return { claimed: false, wasQueued: false }

      // Re-read under the lock so we never steal a chat another caller just
      // claimed (and so re-assignment is a clean no-op, not a takeover).
      const convo = await tx.widgetConversation.findUnique({
        where: { id: params.conversationId },
        select: { assignedUserId: true, queuedAt: true },
      })
      if (!convo || convo.assignedUserId) return { claimed: false, wasQueued: false }

      await tx.widgetConversation.update({
        where: { id: params.conversationId },
        data: {
          assignedUserId: params.userId,
          assignedAt: new Date(),
          assignmentReason: params.reason,
          queuedAt: null,
        },
      })
      return { claimed: true, wasQueued: !!convo.queuedAt }
    })
  } catch (err) {
    console.warn('[widget-routing] capacity slot claim failed:', err instanceof Error ? err.message : String(err))
    return { claimed: false, wasQueued: false }
  }
}

/**
 * Capacity-gated assignment: pick an available assignee and atomically claim
 * a slot for them, then fire the SSE/notify side effects. Returns the
 * assignee on success, or null when there's no capacity, nobody available,
 * or the chat was taken concurrently — in every null case the caller should
 * fall back to the queue (or stop advancing it).
 */
async function assignWithinCapacity(params: {
  workspaceId: string
  conversationId: string
  widgetId: string
  max: number
}): Promise<{ userId: string } | null> {
  const pick = await pickAssignee({ workspaceId: params.workspaceId, widgetId: params.widgetId })
  if (!pick) return null

  const claim = await claimSlotIfCapacity({
    workspaceId: params.workspaceId,
    conversationId: params.conversationId,
    userId: pick.userId,
    reason: pick.reason,
    max: params.max,
  })
  if (!claim.claimed) return null

  await emitAssignmentEffects({
    workspaceId: params.workspaceId,
    conversationId: params.conversationId,
    widgetId: params.widgetId,
    userId: pick.userId,
    reason: pick.reason,
    wasQueued: claim.wasQueued,
  })
  return { userId: pick.userId }
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
    const next = await db.widgetConversation.findFirst({
      where: { widget: { workspaceId }, queuedAt: { not: null }, assignedUserId: null, status: { not: 'ended' } },
      select: { id: true, widgetId: true },
      orderBy: { queuedAt: 'asc' },
    }).catch(() => null)
    if (!next) break
    // assignWithinCapacity re-checks the cap atomically under the per-
    // workspace lock, so concurrent advanceQueue calls (chat-end, presence,
    // cron) can't collectively over-fill. null = no capacity / nobody
    // available / taken concurrently → stop; the next trigger picks up where
    // this left off.
    const assignedTo = await assignWithinCapacity({
      workspaceId,
      conversationId: next.id,
      widgetId: next.widgetId,
      max: settings.maxConcurrentHumanChats,
    })
    if (!assignedTo) break
    assigned++
  }
  await broadcastQueuePositions(workspaceId)
  return { assigned }
}
