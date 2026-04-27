/**
 * Pure function that computes the weekly digest payload for a workspace.
 * Same shape the dashboard page already consumes — extracted here so the
 * cron route can reuse it without round-tripping through HTTP.
 */

import { db } from './db'

export interface AgentDigest {
  id: string
  name: string
  messages: number
  errors: number
  appointments: number
  toolCalls: number
  tokens: number
  followUpsSent: number
  uniqueContactsReached: number
  fallbackCount: number
  estCost: number
}

export interface DigestPayload {
  weekStart: Date
  weekEnd: Date
  totals: {
    messages: number
    appointments: number
    followUpsSent: number
    newConversations: number
    tokens: number
    estCost: number
    deltaVsLastWeek: number | null
  }
  agents: AgentDigest[]
}

const FALLBACK_PATTERNS = ["not sure", "i don't know", "i'm not able to", "let me connect you"]

export async function buildWorkspaceDigest(workspaceId: string, weekEnd: Date = new Date()): Promise<DigestPayload> {
  const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000)
  const prevWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000)

  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  const locationIds = locations.map(l => l.id)
  if (locationIds.length === 0) {
    return {
      weekStart, weekEnd,
      totals: { messages: 0, appointments: 0, followUpsSent: 0, newConversations: 0, tokens: 0, estCost: 0, deltaVsLastWeek: null },
      agents: [],
    }
  }

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
    db.agent.findMany({ where: { workspaceId }, select: { id: true, name: true } }),
  ])

  type AgentBucket = {
    id: string; name: string
    messages: number; errors: number; appointments: number; toolCalls: number
    tokens: number; followUpsSent: number; uniqueContacts: Set<string>; fallbackCount: number
  }
  const agentStats = new Map<string, AgentBucket>()
  for (const a of agents) {
    agentStats.set(a.id, {
      id: a.id, name: a.name,
      messages: 0, errors: 0, appointments: 0, toolCalls: 0,
      tokens: 0, followUpsSent: 0, uniqueContacts: new Set(), fallbackCount: 0,
    })
  }

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

  const agentDigests: AgentDigest[] = Array.from(agentStats.values())
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
      estCost: (s.tokens / 1_000_000) * 3.0,
    }))
    .sort((a, b) => b.messages - a.messages)

  const totalMessages = agentDigests.reduce((sum, a) => sum + a.messages, 0)
  const totalAppointments = agentDigests.reduce((sum, a) => sum + a.appointments, 0)
  const totalFollowUps = agentDigests.reduce((sum, a) => sum + a.followUpsSent, 0)
  const totalTokens = agentDigests.reduce((sum, a) => sum + a.tokens, 0)
  const deltaVsLastWeek = prevLogs > 0 ? Math.round(((totalMessages - prevLogs) / prevLogs) * 100) : null

  return {
    weekStart, weekEnd,
    totals: {
      messages: totalMessages,
      appointments: totalAppointments,
      followUpsSent: totalFollowUps,
      newConversations: conversationsStarted,
      tokens: totalTokens,
      estCost: (totalTokens / 1_000_000) * 3.0,
      deltaVsLastWeek,
    },
    agents: agentDigests,
  }
}
