import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:workspaceId/needs-attention
 *
 * Surfaces conversations where an agent has stopped itself or is clearly
 * stuck. Pulls from:
 *   1. ConversationStateRecord where state=PAUSED (stop conditions hit)
 *   2. Recent MessageLog with status=ERROR or status=SKIPPED
 *   3. MessageLog with fallbackMessage in outboundReply (agent couldn't answer)
 *   4. Conversations with >10 agent turns but no appointment booked (stalled)
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  const locationIds = locations.map(l => l.id)
  if (locationIds.length === 0) {
    return NextResponse.json({ items: [], summary: { paused: 0, errors: 0, fallbacks: 0, stalled: 0 } })
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // last 7 days

  // 1. Paused conversations (stop condition hit)
  const pausedStates = await db.conversationStateRecord.findMany({
    where: {
      locationId: { in: locationIds },
      state: 'PAUSED',
    },
    include: { agent: { select: { id: true, name: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  })

  // 2. Recent errors
  const errors = await db.messageLog.findMany({
    where: {
      locationId: { in: locationIds },
      status: 'ERROR',
      createdAt: { gte: since },
    },
    include: { agent: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })

  // 3. Agents that used fallback — heuristic: outboundReply contains fallback signals
  const fallbackKeywords = ['not sure', "i don't know", "i'm not able to", "let me connect you", "checking on that"]
  const recentLogs = await db.messageLog.findMany({
    where: {
      locationId: { in: locationIds },
      status: 'SUCCESS',
      createdAt: { gte: since },
      outboundReply: { not: null },
    },
    include: { agent: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  const fallbacks = recentLogs.filter(log =>
    log.outboundReply && fallbackKeywords.some(kw =>
      log.outboundReply!.toLowerCase().includes(kw)
    )
  ).slice(0, 30)

  // 4. Stalled conversations — >10 agent turns in the last 7 days, not paused
  const stalledStates = await db.conversationStateRecord.findMany({
    where: {
      locationId: { in: locationIds },
      state: 'ACTIVE',
      messageCount: { gte: 10 },
      updatedAt: { gte: since },
    },
    include: { agent: { select: { id: true, name: true } } },
    orderBy: { messageCount: 'desc' },
    take: 20,
  })

  // Compose items — dedupe by contactId (prefer paused > error > fallback > stalled)
  const seen = new Set<string>()
  const items: any[] = []

  for (const state of pausedStates) {
    if (seen.has(state.contactId)) continue
    seen.add(state.contactId)
    items.push({
      type: 'paused',
      severity: 'high',
      label: 'Agent paused',
      reason: state.pauseReason || 'Stop condition hit',
      contactId: state.contactId,
      conversationId: state.conversationId,
      agent: state.agent,
      at: state.pausedAt ?? state.updatedAt,
      messageCount: state.messageCount,
    })
  }

  for (const err of errors) {
    if (seen.has(err.contactId)) continue
    seen.add(err.contactId)
    items.push({
      type: 'error',
      severity: 'high',
      label: 'Agent error',
      reason: err.errorMessage?.slice(0, 120) || 'Unknown error',
      contactId: err.contactId,
      conversationId: err.conversationId,
      agent: err.agent,
      at: err.createdAt,
      lastMessage: err.inboundMessage?.slice(0, 100),
    })
  }

  for (const fb of fallbacks) {
    if (seen.has(fb.contactId)) continue
    seen.add(fb.contactId)
    items.push({
      type: 'fallback',
      severity: 'medium',
      label: "Agent couldn't answer",
      reason: 'Used fallback language — consider adding a knowledge entry',
      contactId: fb.contactId,
      conversationId: fb.conversationId,
      agent: fb.agent,
      at: fb.createdAt,
      lastMessage: fb.inboundMessage?.slice(0, 100),
      lastReply: fb.outboundReply?.slice(0, 100),
    })
  }

  for (const st of stalledStates) {
    if (seen.has(st.contactId)) continue
    seen.add(st.contactId)
    items.push({
      type: 'stalled',
      severity: 'low',
      label: 'Long conversation',
      reason: `${st.messageCount} turns without resolution`,
      contactId: st.contactId,
      conversationId: st.conversationId,
      agent: st.agent,
      at: st.updatedAt,
      messageCount: st.messageCount,
    })
  }

  return NextResponse.json({
    items,
    summary: {
      paused: pausedStates.length,
      errors: errors.length,
      fallbacks: fallbacks.length,
      stalled: stalledStates.length,
    },
  })
}
