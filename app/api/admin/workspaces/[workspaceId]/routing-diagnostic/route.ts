import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdminSession, logAdminActionAfter } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ workspaceId: string }> }

const ALL_CHANNELS = ['SMS', 'WhatsApp', 'Email', 'FB', 'IG', 'GMB', 'Live_Chat']

/**
 * Admin-only routing diagnostic. Same output shape as the old
 * /api/workspaces/:ws/routing-diagnostic but behind the super-admin gate
 * (not a workspace member check), and deliberately not rate-limited
 * per-customer because it's a staff support tool.
 *
 * Moved out of the customer area because (a) it exposed raw per-agent
 * evaluation traces and recent-inbound previews that aren't customer
 * UX territory, and (b) combined with multi-workspace membership it
 * had a cross-workspace data-leak surface that was easier to eliminate
 * than to police.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const session = await getAdminSession()
  if (!session || !session.twoFactorVerified) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  const locationIds = locations.map(l => l.id)
  if (locationIds.length === 0) {
    return NextResponse.json({ ok: false, message: 'No locations connected to this workspace' })
  }

  const agents = await db.agent.findMany({
    where: {
      // Match either the scalar workspaceId OR via the location FK, so
      // legacy agents with Agent.workspaceId=null still surface. This
      // is the same leniency we use in resume/takeover routes — we want
      // to SEE everything the workspace effectively owns here, even if
      // the scalar migration left some rows blank.
      OR: [
        { workspaceId },
        { locationId: { in: locationIds } },
      ],
      isActive: true,
    },
    include: {
      channelDeployments: true,
      routingRules: { orderBy: { priority: 'asc' } },
    },
  })

  const agentReport = agents.map(agent => {
    const deployments = (agent as any).channelDeployments as { channel: string; isActive: boolean }[]
    const channelMatrix: Record<string, { deployed: boolean; isActive: boolean }> = {}
    for (const ch of ALL_CHANNELS) {
      const d = deployments.find(x => x.channel === ch)
      channelMatrix[ch] = { deployed: !!d, isActive: d?.isActive ?? false }
    }
    const hasAnyDeployment = deployments.length > 0
    const hasActiveDeployment = deployments.some(d => d.isActive)
    const hasAnyRule = agent.routingRules.length > 0
    const hasAllRule = agent.routingRules.some(r => r.ruleType === 'ALL')

    const issues: string[] = []
    if (!hasAnyDeployment) {
      issues.push('No channel deployments — will respond to ALL channels (backward compat). Fine for testing, but consider configuring deployments for production.')
    } else if (!hasActiveDeployment) {
      issues.push('Has deployments but none are active. Agent will NEVER match an inbound.')
    }
    if (!hasAnyRule) {
      issues.push('No routing rules — agent will NEVER be selected. Add at least one rule on the Deploy tab.')
    } else if (!hasAllRule) {
      const hasTagRule = agent.routingRules.some(r => r.ruleType === 'TAG')
      const hasKeywordRule = agent.routingRules.some(r => r.ruleType === 'KEYWORD')
      if (hasTagRule) issues.push('Only TAG rules — inbounds without matching tags will be skipped.')
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

  const recentLogs = await db.messageLog.findMany({
    where: { locationId: { in: locationIds } },
    include: { agent: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  const recent = recentLogs.map(log => ({
    id: log.id,
    at: log.createdAt.toISOString(),
    status: log.status,
    agent: log.agent,
    errorMessage: log.errorMessage,
    inboundPreview: log.inboundMessage?.slice(0, 120),
    contactId: log.contactId,
  }))

  const agentsWithNoDeployments = agentReport.filter(a => a.deployments.length === 0)
  const agentsWithNoRules = agentReport.filter(a => a.routingRules.length === 0)
  const skippedRecently = recent.filter(r => r.status === 'SKIPPED').length

  const workspaceIssues: string[] = []
  if (agents.length === 0) {
    workspaceIssues.push('No active agents in this workspace. Create or enable at least one.')
  }
  if (agentsWithNoRules.length === agents.length && agents.length > 0) {
    workspaceIssues.push('None of your agents have routing rules — inbounds will never be answered.')
  }
  if (skippedRecently >= 3) {
    workspaceIssues.push(`${skippedRecently} of the last 20 inbounds were skipped. Check the Recent inbounds list below.`)
  }

  logAdminActionAfter({
    admin: session,
    action: 'view_routing_diagnostic',
    target: workspaceId,
    meta: { agentCount: agents.length, skippedCount: skippedRecently },
  })

  return NextResponse.json({
    ok: workspaceIssues.length === 0,
    workspaceIssues,
    agents: agentReport,
    recent,
  })
}
