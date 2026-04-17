import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:workspaceId/digest?week=<ISO date>
 *
 * Weekly digest of agent activity. Returns per-agent stats and workspace totals
 * for the week ending at the given date (default: this week).
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const weekParam = url.searchParams.get('week')
  const weekEnd = weekParam ? new Date(weekParam) : new Date()
  const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000)
  const prevWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000)

  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  const locationIds = locations.map(l => l.id)
  if (locationIds.length === 0) return NextResponse.json({ agents: [], totals: {}, weekStart, weekEnd })

  // This week's logs
  const [thisLogs, prevLogs, thisFollowUps, conversationsStarted, agents] = await Promise.all([
    db.messageLog.findMany({
      where: { locationId: { in: locationIds }, createdAt: { gte: weekStart, lte: weekEnd } },
      select: {
        agentId: true, status: true, actionsPerformed: true,
        tokensUsed: true, contactId: true, outboundReply: true,
      },
    }),
    db.messageLog.count({
      where: { locationId: { in: locationIds }, createdAt: { gte: prevWeekStart, lte: weekStart } },
    }),
    db.followUpJob.findMany({
      where: { locationId: { in: locationIds }, lastSentAt: { gte: weekStart, lte: weekEnd } },
      select: { sequence: { select: { agentId: true } } },
    }),
    db.conversationStateRecord.count({
      where: { locationId: { in: locationIds }, createdAt: { gte: weekStart, lte: weekEnd } },
    }),
    db.agent.findMany({
      where: { workspaceId },
      select: { id: true, name: true },
    }),
  ])

  // Per-agent aggregation
  const agentStats = new Map<string, {
    id: string
    name: string
    messages: number
    errors: number
    appointments: number
    toolCalls: number
    tokens: number
    followUpsSent: number
    uniqueContacts: Set<string>
    fallbackCount: number
  }>()

  for (const a of agents) {
    agentStats.set(a.id, {
      id: a.id, name: a.name,
      messages: 0, errors: 0, appointments: 0, toolCalls: 0,
      tokens: 0, followUpsSent: 0, uniqueContacts: new Set(), fallbackCount: 0,
    })
  }

  const FALLBACK_PATTERNS = ["not sure", "i don't know", "i'm not able to", "let me connect you"]

  for (const log of thisLogs) {
    if (!log.agentId) continue
    const s = agentStats.get(log.agentId)
    if (!s) continue
    s.messages++
    if (log.status === 'ERROR') s.errors++
    s.toolCalls += log.actionsPerformed?.length ?? 0
    if (log.actionsPerformed?.includes('book_appointment')) s.appointments++
    s.tokens += log.tokensUsed ?? 0
    s.uniqueContacts.add(log.contactId)
    if (log.outboundReply && FALLBACK_PATTERNS.some(p => log.outboundReply!.toLowerCase().includes(p))) {
      s.fallbackCount++
    }
  }

  for (const f of thisFollowUps) {
    if (!f.sequence.agentId) continue
    const s = agentStats.get(f.sequence.agentId)
    if (s) s.followUpsSent++
  }

  // Convert Sets to counts and compute total
  const agentDigests = Array.from(agentStats.values())
    .map(s => ({
      id: s.id,
      name: s.name,
      messages: s.messages,
      errors: s.errors,
      appointments: s.appointments,
      toolCalls: s.toolCalls,
      tokens: s.tokens,
      followUpsSent: s.followUpsSent,
      uniqueContactsReached: s.uniqueContacts.size,
      fallbackCount: s.fallbackCount,
      estCost: (s.tokens / 1_000_000) * 3.0, // rough Claude Sonnet input estimate
    }))
    .sort((a, b) => b.messages - a.messages)

  // Totals
  const totalMessages = agentDigests.reduce((sum, a) => sum + a.messages, 0)
  const totalAppointments = agentDigests.reduce((sum, a) => sum + a.appointments, 0)
  const totalFollowUps = agentDigests.reduce((sum, a) => sum + a.followUpsSent, 0)
  const totalTokens = agentDigests.reduce((sum, a) => sum + a.tokens, 0)
  const deltaMessages = prevLogs > 0 ? Math.round(((totalMessages - prevLogs) / prevLogs) * 100) : null

  return NextResponse.json({
    weekStart,
    weekEnd,
    totals: {
      messages: totalMessages,
      appointments: totalAppointments,
      followUpsSent: totalFollowUps,
      newConversations: conversationsStarted,
      tokens: totalTokens,
      estCost: (totalTokens / 1_000_000) * 3.0,
      deltaVsLastWeek: deltaMessages,
    },
    agents: agentDigests,
  })
}
