/**
 * GET /api/workspaces/[workspaceId]/activity-feed
 *
 * Unified operator activity feed — folds the four separate
 * needs-attention / approvals / next-actions / corrections endpoints
 * into one chronological stream. Each item is a normalized
 * `ActivityItem` with a category chip, severity, agent context, and
 * a primary action target.
 *
 * Why one endpoint, one feed: the four separate pages each ended up
 * mostly empty for most operators, which trained people to ignore the
 * nav items entirely. A single chronological feed with filter chips
 * matches how every other ops tool (Slack, Linear, etc.) presents
 * work-in-flight — see everything in one place, filter when you need to.
 *
 * The original four routes still work — this just aggregates them.
 * Deleting the old pages is a follow-up after we've validated the
 * unified view in practice; for now the user can fall back if needed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

export type ActivityCategory =
  | 'paused'            // ConversationStateRecord.state = 'PAUSED'
  | 'error'             // Recent agent errors
  | 'stalled'           // Long conversations with no resolution
  | 'approval'          // MessageLog.needsApproval && approvalStatus=pending
  | 'correction'        // Operator-flagged corrections waiting for review
  | 'next_action'       // Scheduled follow-ups (informational)

export interface ActivityItem {
  id: string
  category: ActivityCategory
  severity: 'high' | 'medium' | 'low' | 'info'
  label: string
  reason?: string
  agent?: { id: string; name: string } | null
  contactId?: string | null
  conversationId?: string | null
  at: string
  /**
   * Where clicking the row should navigate. For first cut every item
   * routes to its existing category page with a hash anchor so
   * operators land at the right spot in the old view. Later we can
   * surface inline actions (approve/reject/resume) without nav.
   */
  href: string
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  const locationIds = locations.map(l => l.id)
  if (locationIds.length === 0) {
    return NextResponse.json({ items: [], summary: zeroSummary() })
  }

  // Fan out to every data source in parallel. Each source is
  // best-effort: a fresh workspace pre-migration can be missing some
  // tables entirely (notMigrated path), so wrap each in try/catch
  // and return an empty list on miss. We never fail the whole feed
  // because one source isn't available yet.
  const [
    pausedItems,
    errorItems,
    stalledItems,
    approvalItems,
    correctionItems,
    nextActionItems,
  ] = await Promise.all([
    loadPaused(workspaceId, locationIds).catch(() => []),
    loadErrors(workspaceId, locationIds).catch(() => []),
    loadStalled(workspaceId, locationIds).catch(() => []),
    loadApprovals(workspaceId, locationIds).catch(() => []),
    loadCorrections(workspaceId, locationIds).catch(() => []),
    loadNextActions(workspaceId, locationIds).catch(() => []),
  ])

  const all: ActivityItem[] = [
    ...pausedItems,
    ...errorItems,
    ...stalledItems,
    ...approvalItems,
    ...correctionItems,
    ...nextActionItems,
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

  const summary = {
    total: all.length,
    high: all.filter(i => i.severity === 'high').length,
    medium: all.filter(i => i.severity === 'medium').length,
    low: all.filter(i => i.severity === 'low').length,
    info: all.filter(i => i.severity === 'info').length,
    byCategory: countBy(all, i => i.category),
  }

  return NextResponse.json({ items: all, summary })
}

// ─── Loaders per category ───────────────────────────────────────────

async function loadPaused(workspaceId: string, locationIds: string[]): Promise<ActivityItem[]> {
  const rows = await db.conversationStateRecord.findMany({
    where: { locationId: { in: locationIds }, state: 'PAUSED' },
    include: { agent: { select: { id: true, name: true } } },
    orderBy: { pausedAt: 'desc' },
    take: 50,
  })
  return rows.map((r): ActivityItem => ({
    id: `paused:${r.id}`,
    category: 'paused',
    severity: 'high',
    label: 'Agent paused',
    reason: r.pauseReason || 'Stop condition hit',
    agent: r.agent,
    contactId: r.contactId,
    conversationId: r.conversationId ?? null,
    at: (r.pausedAt ?? r.updatedAt).toISOString(),
    href: `/dashboard/${workspaceId}/needs-attention`,
  }))
}

async function loadErrors(workspaceId: string, locationIds: string[]): Promise<ActivityItem[]> {
  const rows = await db.messageLog.findMany({
    where: {
      locationId: { in: locationIds },
      errorMessage: { not: null },
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    include: { agent: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  return rows.map((r): ActivityItem => ({
    id: `error:${r.id}`,
    category: 'error',
    severity: 'high',
    label: 'Agent error',
    reason: r.errorMessage?.slice(0, 140) ?? 'Unknown error',
    agent: r.agent,
    contactId: r.contactId,
    conversationId: r.conversationId ?? null,
    at: r.createdAt.toISOString(),
    href: `/dashboard/${workspaceId}/needs-attention`,
  }))
}

// loadFallbacks intentionally removed — no `usedFallback` column on
// MessageLog in the current schema. The needs-attention page derives
// fallback detection from other signals; we'd need a schema field to
// surface it as a separate activity category. Wire up when the column
// lands.

async function loadStalled(workspaceId: string, locationIds: string[]): Promise<ActivityItem[]> {
  // Stalled = long-running conversation state with no recent activity.
  // Threshold of 8 turns + 4 hours without an update is a rough first
  // cut; tune later if it surfaces too much / too little.
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000)
  const rows = await db.conversationStateRecord.findMany({
    where: {
      locationId: { in: locationIds },
      state: 'ACTIVE',
      messageCount: { gte: 8 },
      updatedAt: { lte: fourHoursAgo },
    },
    include: { agent: { select: { id: true, name: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 30,
  })
  return rows.map((r): ActivityItem => ({
    id: `stalled:${r.id}`,
    category: 'stalled',
    severity: 'low',
    label: 'Long conversation',
    reason: `${r.messageCount} turns without resolution`,
    agent: r.agent,
    contactId: r.contactId,
    conversationId: r.conversationId ?? null,
    at: r.updatedAt.toISOString(),
    href: `/dashboard/${workspaceId}/needs-attention`,
  }))
}

async function loadApprovals(workspaceId: string, locationIds: string[]): Promise<ActivityItem[]> {
  const rows = await db.messageLog.findMany({
    where: {
      locationId: { in: locationIds },
      needsApproval: true,
      approvalStatus: 'pending',
    },
    include: { agent: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'asc' },
    take: 50,
  })
  return rows.map((r): ActivityItem => ({
    id: `approval:${r.id}`,
    category: 'approval',
    severity: 'high',
    label: 'Approval pending',
    reason: r.outboundReply?.slice(0, 140) ?? 'Reply waiting for review',
    agent: r.agent,
    contactId: r.contactId,
    conversationId: r.conversationId ?? null,
    at: r.createdAt.toISOString(),
    href: `/dashboard/${workspaceId}/approvals`,
  }))
}

async function loadCorrections(workspaceId: string, locationIds: string[]): Promise<ActivityItem[]> {
  const rows = await db.messageCorrection.findMany({
    where: { messageLog: { locationId: { in: locationIds } } },
    include: {
      messageLog: {
        select: {
          id: true,
          contactId: true,
          conversationId: true,
          agent: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })
  return rows.map((r): ActivityItem => ({
    id: `correction:${r.id}`,
    category: 'correction',
    severity: 'medium',
    label: 'Operator correction',
    reason: r.correctedText?.slice(0, 140) ?? 'Operator edited the agent\'s reply',
    agent: r.messageLog?.agent ?? null,
    contactId: r.messageLog?.contactId ?? null,
    conversationId: r.messageLog?.conversationId ?? null,
    at: r.createdAt.toISOString(),
    href: `/dashboard/${workspaceId}/corrections`,
  }))
}

async function loadNextActions(workspaceId: string, locationIds: string[]): Promise<ActivityItem[]> {
  // FollowUpJob is the actual model — feeds through a sequence/step
  // rather than carrying a message field directly. Show the sequence
  // name as the reason; operators can click through for the full plan.
  const rows = await db.followUpJob.findMany({
    where: {
      locationId: { in: locationIds },
      status: 'SCHEDULED',
      scheduledAt: { gte: new Date(), lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    },
    include: {
      sequence: { select: { name: true, agent: { select: { id: true, name: true } } } },
    },
    orderBy: { scheduledAt: 'asc' },
    take: 30,
  })
  return rows.map((r): ActivityItem => ({
    id: `next_action:${r.id}`,
    category: 'next_action',
    severity: 'info',
    label: 'Scheduled follow-up',
    reason: r.sequence?.name ? `Sequence: ${r.sequence.name} (step ${r.currentStep})` : 'Scheduled follow-up',
    agent: r.sequence?.agent ?? null,
    contactId: r.contactId,
    conversationId: r.conversationId ?? null,
    at: r.scheduledAt.toISOString(),
    href: `/dashboard/${workspaceId}/next-actions`,
  }))
}

// ─── Helpers ────────────────────────────────────────────────────────

function zeroSummary() {
  return { total: 0, high: 0, medium: 0, low: 0, info: 0, byCategory: {} as Record<string, number> }
}

function countBy<T, K extends string>(arr: T[], key: (t: T) => K): Record<K, number> {
  return arr.reduce((acc, item) => {
    const k = key(item)
    acc[k] = (acc[k] ?? 0) + 1
    return acc
  }, {} as Record<K, number>)
}
