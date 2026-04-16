/**
 * Usage tracking service.
 *
 * Records message and voice usage per workspace per billing period.
 * Increments workspace-level counters for fast real-time checks
 * and creates granular UsageRecord rows for Stripe reporting.
 */

import { db } from '@/lib/db'
import { currentBillingPeriod } from '@/lib/plans'

/**
 * Record a message sent by an AI agent.
 * - Increments workspace.messageUsage atomically
 * - Creates a UsageRecord for Stripe metered billing
 */
export async function trackMessageUsage(workspaceId: string, agentId: string): Promise<void> {
  const period = currentBillingPeriod()

  await Promise.all([
    // Atomic increment on workspace counter
    db.workspace.update({
      where: { id: workspaceId },
      data: { messageUsage: { increment: 1 } },
    }),

    // Granular record for billing reconciliation
    db.usageRecord.create({
      data: {
        workspaceId,
        type: 'message',
        quantity: 1,
        agentId,
        billingPeriod: period,
      },
    }),
  ])
}

/**
 * Record voice usage in seconds.
 * - Increments workspace.voiceMinuteUsage (stored in seconds) atomically
 * - Creates a UsageRecord
 */
export async function trackVoiceUsage(workspaceId: string, agentId: string, durationSeconds: number): Promise<void> {
  if (durationSeconds <= 0) return
  const period = currentBillingPeriod()

  await Promise.all([
    db.workspace.update({
      where: { id: workspaceId },
      data: { voiceMinuteUsage: { increment: durationSeconds } },
    }),

    db.usageRecord.create({
      data: {
        workspaceId,
        type: 'voice_minute',
        quantity: durationSeconds,
        agentId,
        billingPeriod: period,
      },
    }),
  ])
}

/**
 * Get current usage for a workspace in the current billing period.
 */
export async function getCurrentUsage(workspaceId: string): Promise<{
  messages: number
  messageLimit: number
  voiceSeconds: number
  voiceMinuteLimit: number
  plan: string
  trialEndsAt: Date | null
}> {
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      messageUsage: true,
      messageLimit: true,
      voiceMinuteUsage: true,
      voiceMinuteLimit: true,
      plan: true,
      trialEndsAt: true,
    },
  })

  if (!ws) throw new Error('Workspace not found')

  return {
    messages: ws.messageUsage,
    messageLimit: ws.messageLimit,
    voiceSeconds: ws.voiceMinuteUsage,
    voiceMinuteLimit: ws.voiceMinuteLimit,
    plan: ws.plan,
    trialEndsAt: ws.trialEndsAt,
  }
}

/**
 * Reset usage counters — called at the start of each billing period
 * (triggered by Stripe webhook on subscription renewal or by cron).
 */
export async function resetUsageCounters(workspaceId: string): Promise<void> {
  await db.workspace.update({
    where: { id: workspaceId },
    data: {
      messageUsage: 0,
      voiceMinuteUsage: 0,
    },
  })
}

/**
 * Get overage counts for billing.
 */
export async function getOverageForPeriod(workspaceId: string, billingPeriod: string): Promise<{
  totalMessages: number
  totalVoiceSeconds: number
}> {
  const [msgAgg, voiceAgg] = await Promise.all([
    db.usageRecord.aggregate({
      where: { workspaceId, billingPeriod, type: 'message' },
      _sum: { quantity: true },
    }),
    db.usageRecord.aggregate({
      where: { workspaceId, billingPeriod, type: 'voice_minute' },
      _sum: { quantity: true },
    }),
  ])

  return {
    totalMessages: msgAgg._sum.quantity || 0,
    totalVoiceSeconds: voiceAgg._sum.quantity || 0,
  }
}
