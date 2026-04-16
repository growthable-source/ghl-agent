import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { getCurrentUsage } from '@/lib/usage'
import { getPlanFeatures, isTrialExpired } from '@/lib/plans'

/**
 * GET /api/billing/usage?workspaceId=xxx
 * Returns current billing period usage and plan details.
 */
export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspaceId')
  if (!workspaceId) {
    return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 })
  }

  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const usage = await getCurrentUsage(workspaceId)
  const features = getPlanFeatures(usage.plan)
  const trialExpired = isTrialExpired(usage.trialEndsAt)

  const voiceMinutesUsed = Math.ceil(usage.voiceSeconds / 60)
  const messageOverage = Math.max(0, usage.messages - usage.messageLimit)
  const voiceOverage = Math.max(0, voiceMinutesUsed - usage.voiceMinuteLimit)

  return NextResponse.json({
    plan: usage.plan,
    planLabel: features.label,
    trialEndsAt: usage.trialEndsAt,
    trialExpired,
    messages: {
      used: usage.messages,
      limit: usage.messageLimit,
      overage: messageOverage,
      overageRate: features.messageOveragePrice,
      estimatedOverageCost: +(messageOverage * features.messageOveragePrice).toFixed(2),
    },
    voice: {
      minutesUsed: voiceMinutesUsed,
      minuteLimit: usage.voiceMinuteLimit,
      overage: voiceOverage,
      overageRate: features.voiceOveragePrice,
      estimatedOverageCost: +(voiceOverage * features.voiceOveragePrice).toFixed(2),
    },
    features: {
      agents: features.agents,
      channels: features.channels,
      voiceEnabled: features.voiceEnabled,
      crossDomainInvites: features.crossDomainInvites,
      leadScoring: features.leadScoring,
      sentimentDetection: features.sentimentDetection,
      customPersona: features.customPersona,
      teamMembers: features.teamMembers === Infinity ? 'unlimited' : features.teamMembers,
      workspaces: features.workspaces,
      knowledgeEntries: features.knowledgeEntries,
    },
  })
}
