import { db } from './db'

/**
 * Given an agent's approval config and the current context, decide if this
 * outbound reply should be held for human approval.
 *
 * approvalRules JSON shape (all optional booleans):
 *   { firstContact: true, lowSentiment: true, longMessage: true, refundMention: true, dollarMention: true }
 */
export interface ApprovalContext {
  requireApproval: boolean
  approvalRules: Record<string, unknown> | null
  contactId: string
  agentId: string
  inboundMessage: string
  outboundReply: string | null | undefined
  priorMessageCount: number
}

export function evaluateApprovalNeed(ctx: ApprovalContext): { needsApproval: boolean; reason: string | null } {
  if (!ctx.requireApproval) return { needsApproval: false, reason: null }
  if (!ctx.outboundReply) return { needsApproval: false, reason: null }

  const rules = (ctx.approvalRules || {}) as Record<string, boolean>
  const inbound = ctx.inboundMessage.toLowerCase()
  const outbound = ctx.outboundReply.toLowerCase()

  // First contact — no prior messages
  if (rules.firstContact && ctx.priorMessageCount === 0) {
    return { needsApproval: true, reason: 'first_contact' }
  }

  // Long message
  if (rules.longMessage && ctx.outboundReply.length > 500) {
    return { needsApproval: true, reason: 'long_message' }
  }

  // Refund / complaint mentions
  if (rules.refundMention && /\b(refund|complaint|angry|upset|cancel|lawsuit|lawyer)\b/.test(inbound + ' ' + outbound)) {
    return { needsApproval: true, reason: 'refund_mention' }
  }

  // Dollar amount mentions
  if (rules.dollarMention && /\$\s?\d/.test(outbound)) {
    return { needsApproval: true, reason: 'high_value' }
  }

  // Low sentiment — crude heuristic on inbound
  if (rules.lowSentiment && /\b(hate|terrible|awful|worst|frustrated|useless|scam)\b/i.test(inbound)) {
    return { needsApproval: true, reason: 'low_sentiment' }
  }

  return { needsApproval: false, reason: null }
}

/**
 * Record goal achievements based on actions performed in this turn.
 */
export async function recordGoalAchievements(params: {
  agentId: string
  contactId: string
  conversationId: string | null
  actionsPerformed: string[]
  priorMessageCount: number
}) {
  try {
    const goals = await db.agentGoal.findMany({
      where: { agentId: params.agentId, isActive: true },
    })
    for (const goal of goals) {
      let achieved = false

      if (goal.goalType === 'appointment_booked' && params.actionsPerformed.includes('book_appointment')) {
        achieved = true
      } else if (goal.goalType === 'opportunity_created' && params.actionsPerformed.includes('create_opportunity')) {
        achieved = true
      } else if (goal.goalType === 'custom' && goal.value && params.actionsPerformed.includes(goal.value)) {
        achieved = true
      }
      // tag_added / opportunity_moved require inspecting the tool input — skipped here

      if (!achieved) continue

      // Respect maxTurns threshold
      if (goal.maxTurns && params.priorMessageCount + 1 > goal.maxTurns) continue

      // Avoid double-recording the same win
      const existing = await db.agentGoalEvent.findFirst({
        where: {
          goalId: goal.id,
          contactId: params.contactId,
          achievedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      })
      if (existing) continue

      const evt = await db.agentGoalEvent.create({
        data: {
          goalId: goal.id,
          contactId: params.contactId,
          conversationId: params.conversationId,
          turnsToAchieve: params.priorMessageCount + 1,
        },
      })

      // Mirror the achievement to any running A/B experiment that's
      // measuring this goal type. Idempotent — duplicate calls collapse
      // to a single conversion event per (experiment, contact).
      try {
        const { recordExperimentConversion } = await import('./experiments')
        const metricKey = goal.goalType === 'custom' && goal.value
          ? `custom:${goal.value}`
          : goal.goalType
        await recordExperimentConversion({
          agentId: params.agentId,
          contactId: params.contactId,
          metricKey,
          goalEventId: evt.id,
        })
      } catch { /* never block goal recording on experiment bookkeeping */ }
    }
  } catch (err: any) {
    console.warn('[Goals] recordGoalAchievements failed:', err.message)
  }
}

/**
 * Check if a contact has opted out of this channel. Returns true if blocked.
 */
export async function isContactBlocked(workspaceId: string, contactId: string, channel: string): Promise<boolean> {
  try {
    const consent = await db.contactConsent.findUnique({
      where: {
        contactId_channel_workspaceId: { contactId, channel, workspaceId },
      },
      select: { status: true },
    })
    return consent?.status === 'opted_out'
  } catch {
    return false
  }
}
