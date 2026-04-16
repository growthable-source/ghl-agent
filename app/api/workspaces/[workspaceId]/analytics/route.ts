import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

/**
 * GET /api/workspaces/:id/analytics?range=7d|30d|90d&compare=true
 *
 * Returns comprehensive analytics for the workspace dashboard:
 *  - KPI cards (messages, conversations, appointments, calls, tokens, time saved)
 *  - Daily time-series for charts
 *  - Agent breakdown
 *  - Channel breakdown
 *  - Recent activity feed
 *  - Optional comparison to previous period
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = req.nextUrl
  const range = url.searchParams.get('range') || '7d'
  const compare = url.searchParams.get('compare') === 'true'

  // Parse range
  const rangeDays = range === '90d' ? 90 : range === '30d' ? 30 : 7
  const now = new Date()
  const periodStart = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000)
  const prevPeriodStart = new Date(periodStart.getTime() - rangeDays * 24 * 60 * 60 * 1000)

  // Get all locationIds for this workspace
  const locations = await db.location.findMany({
    where: { workspaceId },
    select: { id: true },
  })
  const locationIds = locations.map(l => l.id)
  const locFilter = locationIds.length > 0
    ? { locationId: { in: locationIds } }
    : { locationId: '__none__' }

  // ─── Current period queries ───────────────────────────────────────

  const [
    totalMessages,
    successMessages,
    errorMessages,
    skippedMessages,
    tokenSum,
    activeConversations,
    totalConversations,
    callCount,
    callDurationSum,
    agentCount,
    messageLogs,     // for time series + action parsing
    callLogs,        // for time series
  ] = await Promise.all([
    db.messageLog.count({ where: { ...locFilter, createdAt: { gte: periodStart } } }),
    db.messageLog.count({ where: { ...locFilter, status: 'SUCCESS', createdAt: { gte: periodStart } } }),
    db.messageLog.count({ where: { ...locFilter, status: 'ERROR', createdAt: { gte: periodStart } } }),
    db.messageLog.count({ where: { ...locFilter, status: 'SKIPPED', createdAt: { gte: periodStart } } }),
    db.messageLog.aggregate({
      where: { ...locFilter, createdAt: { gte: periodStart } },
      _sum: { tokensUsed: true },
    }),
    db.conversationStateRecord.count({
      where: { ...(locationIds.length > 0 ? { locationId: { in: locationIds } } : { locationId: '__none__' }), state: 'ACTIVE' },
    }),
    db.conversationStateRecord.count({
      where: { ...(locationIds.length > 0 ? { locationId: { in: locationIds } } : { locationId: '__none__' }) },
    }),
    db.callLog.count({
      where: { ...(locationIds.length > 0 ? { locationId: { in: locationIds } } : { locationId: '__none__' }), createdAt: { gte: periodStart } },
    }),
    db.callLog.aggregate({
      where: { ...(locationIds.length > 0 ? { locationId: { in: locationIds } } : { locationId: '__none__' }), createdAt: { gte: periodStart } },
      _sum: { durationSecs: true },
    }),
    db.agent.count({ where: { workspaceId, isActive: true } }),
    // Fetch raw logs for aggregation
    db.messageLog.findMany({
      where: { ...locFilter, createdAt: { gte: periodStart } },
      select: {
        createdAt: true,
        status: true,
        actionsPerformed: true,
        tokensUsed: true,
        agentId: true,
        agent: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.callLog.findMany({
      where: { ...(locationIds.length > 0 ? { locationId: { in: locationIds } } : { locationId: '__none__' }), createdAt: { gte: periodStart } },
      select: {
        createdAt: true,
        durationSecs: true,
        status: true,
        agentId: true,
        direction: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
  ])

  // ─── Previous period (for comparison) ─────────────────────────────

  let prev: {
    totalMessages: number
    successMessages: number
    callCount: number
    callDuration: number
    tokens: number
  } | null = null

  if (compare) {
    const [pMsgs, pSuccess, pCalls, pCallDur, pTokens] = await Promise.all([
      db.messageLog.count({ where: { ...locFilter, createdAt: { gte: prevPeriodStart, lt: periodStart } } }),
      db.messageLog.count({ where: { ...locFilter, status: 'SUCCESS', createdAt: { gte: prevPeriodStart, lt: periodStart } } }),
      db.callLog.count({ where: { ...(locationIds.length > 0 ? { locationId: { in: locationIds } } : { locationId: '__none__' }), createdAt: { gte: prevPeriodStart, lt: periodStart } } }),
      db.callLog.aggregate({ where: { ...(locationIds.length > 0 ? { locationId: { in: locationIds } } : { locationId: '__none__' }), createdAt: { gte: prevPeriodStart, lt: periodStart } }, _sum: { durationSecs: true } }),
      db.messageLog.aggregate({ where: { ...locFilter, createdAt: { gte: prevPeriodStart, lt: periodStart } }, _sum: { tokensUsed: true } }),
    ])
    prev = {
      totalMessages: pMsgs,
      successMessages: pSuccess,
      callCount: pCalls,
      callDuration: pCallDur._sum.durationSecs || 0,
      tokens: pTokens._sum.tokensUsed || 0,
    }
  }

  // ─── Parse appointments from actionsPerformed ─────────────────────

  let appointmentsBooked = 0
  const agentMap = new Map<string, { name: string; messages: number; success: number; appointments: number; calls: number }>()

  for (const log of messageLogs) {
    const agentId = log.agentId || 'unknown'
    const agentName = log.agent?.name || 'Unknown Agent'

    if (!agentMap.has(agentId)) {
      agentMap.set(agentId, { name: agentName, messages: 0, success: 0, appointments: 0, calls: 0 })
    }
    const entry = agentMap.get(agentId)!
    entry.messages++
    if (log.status === 'SUCCESS') entry.success++

    // Count appointments booked
    if (log.actionsPerformed.some(a => a.toLowerCase().includes('book_appointment'))) {
      appointmentsBooked++
      entry.appointments++
    }
  }

  // Add call counts to agent map
  for (const call of callLogs) {
    const agentId = call.agentId || 'unknown'
    if (agentMap.has(agentId)) {
      agentMap.get(agentId)!.calls++
    } else {
      agentMap.set(agentId, { name: 'Unknown Agent', messages: 0, success: 0, appointments: 0, calls: 1 })
    }
  }

  // ─── Build daily time series ──────────────────────────────────────

  const dailyMap = new Map<string, { messages: number; success: number; errors: number; calls: number; appointments: number; tokens: number }>()

  // Initialize all days in range
  for (let d = new Date(periodStart); d <= now; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().split('T')[0]
    dailyMap.set(key, { messages: 0, success: 0, errors: 0, calls: 0, appointments: 0, tokens: 0 })
  }

  for (const log of messageLogs) {
    const key = log.createdAt.toISOString().split('T')[0]
    const day = dailyMap.get(key)
    if (day) {
      day.messages++
      if (log.status === 'SUCCESS') day.success++
      if (log.status === 'ERROR') day.errors++
      day.tokens += log.tokensUsed || 0
      if (log.actionsPerformed.some(a => a.toLowerCase().includes('book_appointment'))) {
        day.appointments++
      }
    }
  }

  for (const call of callLogs) {
    const key = call.createdAt.toISOString().split('T')[0]
    const day = dailyMap.get(key)
    if (day) day.calls++
  }

  const timeSeries = Array.from(dailyMap.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // ─── Channel breakdown ────────────────────────────────────────────

  const channelDeployments = await db.channelDeployment.findMany({
    where: { agent: { workspaceId }, isActive: true },
    select: { channel: true, agentId: true },
  })
  const channelCounts: Record<string, number> = {}
  for (const dep of channelDeployments) {
    channelCounts[dep.channel] = (channelCounts[dep.channel] || 0) + 1
  }

  // ─── Recent calls for feed ────────────────────────────────────────

  const recentCalls = await db.callLog.findMany({
    where: { ...(locationIds.length > 0 ? { locationId: { in: locationIds } } : { locationId: '__none__' }) },
    select: {
      id: true,
      contactPhone: true,
      direction: true,
      status: true,
      durationSecs: true,
      summary: true,
      createdAt: true,
      agentId: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  // ─── Time saved estimate ──────────────────────────────────────────
  // Estimate: each AI message saves ~2 min of human response time
  // Each AI call saves ~5 min of human call time
  const estimatedMinutesSaved = (successMessages * 2) + (callCount * 5)

  // ─── Response ─────────────────────────────────────────────────────

  const successRate = totalMessages > 0 ? Math.round((successMessages / totalMessages) * 100) : 0
  const totalCallMinutes = Math.round((callDurationSum._sum.durationSecs || 0) / 60)
  const totalTokens = tokenSum._sum.tokensUsed || 0

  function pctChange(current: number, previous: number): number | null {
    if (!prev) return null
    if (previous === 0) return current > 0 ? 100 : 0
    return Math.round(((current - previous) / previous) * 100)
  }

  return NextResponse.json({
    range: rangeDays,
    periodStart: periodStart.toISOString(),
    periodEnd: now.toISOString(),

    kpi: {
      totalMessages,
      successRate,
      activeConversations,
      totalConversations,
      appointmentsBooked,
      callCount,
      totalCallMinutes,
      totalTokens,
      activeAgents: agentCount,
      estimatedMinutesSaved,
      errorMessages,
      skippedMessages,
      // Comparison deltas
      ...(prev && {
        messagesDelta: pctChange(totalMessages, prev.totalMessages),
        successRateDelta: prev.totalMessages > 0
          ? successRate - Math.round((prev.successMessages / prev.totalMessages) * 100)
          : null,
        callsDelta: pctChange(callCount, prev.callCount),
        tokensDelta: pctChange(totalTokens, prev.tokens),
      }),
    },

    timeSeries,

    agentBreakdown: Array.from(agentMap.entries()).map(([id, data]) => ({
      id,
      ...data,
      successRate: data.messages > 0 ? Math.round((data.success / data.messages) * 100) : 0,
    })),

    channelBreakdown: Object.entries(channelCounts).map(([channel, agents]) => ({
      channel,
      agents,
    })),

    recentCalls,
  })
}
