import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

const ALL_CHANNELS = ['SMS', 'WhatsApp', 'Email', 'FB', 'IG', 'GMB', 'Live_Chat']

/**
 * GET /api/workspaces/:workspaceId/routing-diagnostic
 *
 * For each active agent in the workspace, reports:
 *   - which channels it's deployed on
 *   - what routing rules it has
 *   - an eligibility matrix per channel
 *
 * Also looks at the last 10 inbound messages — did any fail to route?
 * If so, which channel did they arrive on, and why was no agent matched?
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  const locationIds = locations.map(l => l.id)
  if (locationIds.length === 0) {
    return NextResponse.json({ ok: false, message: 'No locations connected to this workspace' })
  }

  const agents = await db.agent.findMany({
    where: { workspaceId, isActive: true },
    include: {
      channelDeployments: true,
      routingRules: { orderBy: { priority: 'asc' } },
    },
  })

  // Per-agent channel eligibility
  const agentReport = agents.map(agent => {
    const deployments = (agent as any).channelDeployments as { channel: string; isActive: boolean }[]
    const channelMatrix: Record<string, { deployed: boolean; isActive: boolean }> = {}
    for (const ch of ALL_CHANNELS) {
      const d = deployments.find(x => x.channel === ch)
      channelMatrix[ch] = {
        deployed: !!d,
        isActive: d?.isActive ?? false,
      }
    }
    const hasAnyDeployment = deployments.length > 0
    const hasActiveDeployment = deployments.some(d => d.isActive)
    const hasAnyRule = agent.routingRules.length > 0
    const hasAllRule = agent.routingRules.some(r => r.ruleType === 'ALL')

    const issues: string[] = []
    if (!hasAnyDeployment) {
      issues.push('No channel deployments — will respond to ALL channels (backward compat). Fine for testing, but consider configuring deployments for production.')
    } else if (!hasActiveDeployment) {
      issues.push('Has deployments but none are active. Agent will NEVER match an inbound. Toggle at least one on in Agent → Channels.')
    }
    if (!hasAnyRule) {
      issues.push('No routing rules — agent will NEVER be selected, even if channel matches. Add at least one rule (use ALL to catch everything).')
    } else if (!hasAllRule) {
      const hasTagRule = agent.routingRules.some(r => r.ruleType === 'TAG')
      const hasKeywordRule = agent.routingRules.some(r => r.ruleType === 'KEYWORD')
      if (hasTagRule) issues.push('Only TAG rules — inbounds from contacts without matching tags will be skipped.')
      if (hasKeywordRule) issues.push('Only KEYWORD rules — inbounds without matching keywords will be skipped.')
    }

    return {
      id: agent.id,
      name: agent.name,
      hasCalendar: !!agent.calendarId,
      deployments: deployments.map(d => ({ channel: d.channel, isActive: d.isActive })),
      channelMatrix,
      routingRules: agent.routingRules.map(r => ({ ruleType: r.ruleType, value: r.value, priority: r.priority })),
      issues,
    }
  })

  // Last 10 inbound messages — any skipped?
  const recentLogs = await db.messageLog.findMany({
    where: { locationId: { in: locationIds } },
    include: { agent: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  const recent = recentLogs.map(log => ({
    id: log.id,
    at: log.createdAt.toISOString(),
    status: log.status,
    agent: log.agent,
    errorMessage: log.errorMessage,
    inboundPreview: log.inboundMessage?.slice(0, 80),
    contactId: log.contactId,
  }))

  // Heuristic: does the workspace look healthy?
  const agentsWithNoDeployments = agentReport.filter(a => a.deployments.length === 0)
  const agentsWithNoRules = agentReport.filter(a => a.routingRules.length === 0)
  const skippedRecently = recent.filter(r => r.status === 'SKIPPED').length

  const workspaceIssues: string[] = []
  if (agents.length === 0) {
    workspaceIssues.push('No active agents in this workspace. Create or enable at least one.')
  }
  if (agentsWithNoRules.length === agents.length && agents.length > 0) {
    workspaceIssues.push('None of your agents have routing rules — inbounds will never be answered. Add an ALL rule to your primary agent.')
  }
  if (skippedRecently >= 3) {
    workspaceIssues.push(`${skippedRecently} of the last 10 inbounds were skipped. Check the "Recent inbounds" list below for why.`)
  }

  return NextResponse.json({
    ok: workspaceIssues.length === 0,
    workspaceIssues,
    agents: agentReport,
    recent,
  })
}
