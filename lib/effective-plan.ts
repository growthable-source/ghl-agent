/**
 * Effective plan resolution.
 *
 * Today the schema stores `plan`, `trialEndsAt`, `stripeCustomerId`, etc.
 * on the Workspace row. That made sense when one workspace == one
 * subscription. As soon as a user owns multiple workspaces, the model
 * leaks: each new workspace gets its own "trial" + "trialEndsAt", and the
 * gates fire trial-expired on workspaces #2..#N even when the owner is
 * already paying for Scale on workspace #1.
 *
 * Fix without a migration: every plan-gating decision routes through
 * `getEffectivePlan(workspaceId)`, which finds the workspace's owner and
 * picks the *best* plan + the *latest* trial across all the workspaces
 * that owner is on. The local `workspace.plan` is now a denormalized
 * historical field — kept for back-compat, ignored by gates.
 *
 * If/when we move the plan onto the User (or a dedicated Account row),
 * this helper becomes a one-line lookup; every call site stays the same.
 */

import { db } from './db'
import { isTrialExpired, type PlanId } from './plans'

const PLAN_RANK: Record<string, number> = {
  scale: 4,
  growth: 3,
  starter: 2,
  free: 1,
  trial: 0,
}

export interface EffectivePlan {
  plan: PlanId
  trialEndsAt: Date | null
  /** Aggregate seat budget across owned workspaces (ie what the operator paid for). */
  agentLimit: number
  extraAgentCount: number
  /** True when on 'trial' AND that trial is in the past. */
  trialExpired: boolean
  /** Whether the user actually owns at least one workspace; false on member-only sessions. */
  ownsAny: boolean
}

const FALLBACK: EffectivePlan = {
  plan: 'trial',
  trialEndsAt: null,
  agentLimit: 3,
  extraAgentCount: 0,
  trialExpired: false,
  ownsAny: false,
}

function pickBest(rows: Array<{
  plan: string
  trialEndsAt: Date | null
  agentLimit: number
  extraAgentCount: number
}>): EffectivePlan {
  if (rows.length === 0) return FALLBACK
  let bestPlan = 'trial'
  let bestRank = -1
  let latestTrial: Date | null = null
  for (const r of rows) {
    const rank = PLAN_RANK[r.plan] ?? -1
    if (rank > bestRank) { bestRank = rank; bestPlan = r.plan }
    if (r.plan === 'trial' && r.trialEndsAt) {
      if (!latestTrial || r.trialEndsAt > latestTrial) latestTrial = r.trialEndsAt
    }
  }
  // Aggregate seats: across the owner's owned workspaces, sum the
  // agentLimit + extraAgentCount of any rows that match the chosen
  // top plan. (We don't sum across plan tiers — only the rows that
  // are on the effective plan contribute their entitlement.)
  const matching = rows.filter(r => r.plan === bestPlan)
  const agentLimit = matching.reduce((s, r) => Math.max(s, r.agentLimit), 0) || 3
  const extraAgentCount = matching.reduce((s, r) => s + (r.extraAgentCount ?? 0), 0)

  return {
    plan: bestPlan as PlanId,
    trialEndsAt: latestTrial,
    agentLimit,
    extraAgentCount,
    trialExpired: bestPlan === 'trial' && isTrialExpired(latestTrial),
    ownsAny: true,
  }
}

/** Effective plan for a specific workspace — walks the owner's portfolio. */
export async function getEffectivePlan(workspaceId: string): Promise<EffectivePlan> {
  // Resolve the owner. Fall back to first member (treat as owner) when
  // no explicit owner row exists, which can happen on legacy workspaces.
  let owner: { userId: string } | null
  try {
    owner = await db.workspaceMember.findFirst({
      where: { workspaceId, role: 'owner' },
      select: { userId: true },
    })
    if (!owner) {
      owner = await db.workspaceMember.findFirst({
        where: { workspaceId },
        orderBy: { createdAt: 'asc' },
        select: { userId: true },
      })
    }
  } catch {
    return FALLBACK
  }
  if (!owner) return FALLBACK
  return getEffectivePlanForUser(owner.userId)
}

/** Effective plan for a specific user — used by `+ New workspace` flows. */
export async function getEffectivePlanForUser(userId: string): Promise<EffectivePlan> {
  let memberships: Array<{ workspace: { plan: string; trialEndsAt: Date | null; agentLimit: number; extraAgentCount: number } | null }> = []
  try {
    memberships = await db.workspaceMember.findMany({
      where: { userId, role: 'owner' },
      select: {
        workspace: {
          select: { plan: true, trialEndsAt: true, agentLimit: true, extraAgentCount: true },
        },
      },
    })
  } catch {
    return FALLBACK
  }
  const rows = memberships.map(m => m.workspace).filter((w): w is NonNullable<typeof memberships[number]['workspace']> => !!w)
  return pickBest(rows)
}
