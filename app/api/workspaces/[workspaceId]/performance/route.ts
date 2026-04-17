import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET — workspace-wide performance heatmap: messages and appointments by
 * day-of-week × hour-of-day. Plus channel breakdown over time.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const days = parseInt(url.searchParams.get('days') || '30')
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  const locationIds = locations.map(l => l.id)
  if (locationIds.length === 0) {
    return NextResponse.json({ heatmap: [], channelBreakdown: [], goalBreakdown: [] })
  }

  // All messages in the window
  const logs = await db.messageLog.findMany({
    where: {
      locationId: { in: locationIds },
      createdAt: { gte: since },
    },
    select: { createdAt: true, actionsPerformed: true, status: true, agent: { select: { id: true, name: true } } },
  })

  // Build 7×24 heatmap — day of week (0=Sun) × hour of day
  const heatmap: { day: number; hour: number; messages: number; wins: number }[] = []
  const grid: Record<string, { messages: number; wins: number }> = {}
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      grid[`${d}-${h}`] = { messages: 0, wins: 0 }
    }
  }

  for (const log of logs) {
    const d = log.createdAt.getDay()
    const h = log.createdAt.getHours()
    const key = `${d}-${h}`
    grid[key].messages++
    if (log.actionsPerformed?.includes('book_appointment')) {
      grid[key].wins++
    }
  }

  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const cell = grid[`${d}-${h}`]
      heatmap.push({ day: d, hour: h, messages: cell.messages, wins: cell.wins })
    }
  }

  // Channel breakdown over time — pull from FollowUpJob (has `channel`) + channelDeployments
  const followUps = await db.followUpJob.groupBy({
    by: ['channel'],
    where: { locationId: { in: locationIds }, createdAt: { gte: since } },
    _count: { _all: true },
  })

  const channelBreakdown = followUps.map(f => ({
    channel: f.channel,
    count: f._count._all,
  }))

  // Goal wins breakdown (across all agents in workspace)
  const agents = await db.agent.findMany({ where: { workspaceId }, select: { id: true, name: true } })
  const agentIds = agents.map(a => a.id)

  let goalBreakdown: Array<{ agent: { id: string; name: string }; goalName: string; wins: number }> = []
  try {
    const goalEvents = await db.agentGoalEvent.findMany({
      where: {
        goal: { agentId: { in: agentIds } },
        achievedAt: { gte: since },
      },
      include: { goal: { select: { name: true, agentId: true } } },
    })

    const groups: Record<string, { agent: { id: string; name: string }; goalName: string; wins: number }> = {}
    for (const e of goalEvents) {
      const agent = agents.find(a => a.id === e.goal.agentId)
      if (!agent) continue
      const k = `${agent.id}-${e.goal.name}`
      if (!groups[k]) groups[k] = { agent, goalName: e.goal.name, wins: 0 }
      groups[k].wins++
    }
    goalBreakdown = Object.values(groups).sort((a, b) => b.wins - a.wins).slice(0, 20)
  } catch {}

  return NextResponse.json({ heatmap, channelBreakdown, goalBreakdown, days })
}
