/**
 * Two-factor gate for ticketing.
 *
 *   1. Plan must include the feature flag (lib/plans.ts — scale only).
 *   2. Workspace must have TicketingSettings.enabled = true.
 *
 * Both must be true. The plan flag is what we charge for; the
 * workspace toggle is what the operator opts INTO. Surfacing the
 * combined check from one place keeps the inbox, sidebar, and every
 * API endpoint from accidentally drifting on which combination of
 * checks they apply.
 */

import { db } from '@/lib/db'
import { getEffectivePlan } from '@/lib/effective-plan'
import { getPlanFeatures } from '@/lib/plans'

export interface TicketingStatus {
  planAllows: boolean
  workspaceEnabled: boolean
  /** Both planAllows AND workspaceEnabled. Use this for "should I
   *  render the UI / accept the API call". */
  active: boolean
  /** Why it's off (presentation only). */
  reason: 'active' | 'plan_locked' | 'not_enabled' | 'plan_locked_and_not_enabled'
}

export async function getTicketingStatus(workspaceId: string): Promise<TicketingStatus> {
  let planAllows = false
  try {
    const effective = await getEffectivePlan(workspaceId)
    planAllows = !!getPlanFeatures(effective.plan).ticketing
  } catch {
    // Account-level plan resolution failed (cold workspace, etc).
    // Fall back to the workspace's local plan row.
    try {
      const ws = await db.workspace.findUnique({
        where: { id: workspaceId },
        select: { plan: true },
      })
      planAllows = !!getPlanFeatures(ws?.plan ?? 'trial').ticketing
    } catch {
      planAllows = false
    }
  }

  let workspaceEnabled = false
  try {
    const settings = await (db as any).ticketingSettings.findUnique({
      where: { workspaceId },
      select: { enabled: true },
    })
    workspaceEnabled = !!settings?.enabled
  } catch {
    // Table missing pre-migration — treat as disabled.
    workspaceEnabled = false
  }

  const active = planAllows && workspaceEnabled
  const reason: TicketingStatus['reason'] = active
    ? 'active'
    : !planAllows && !workspaceEnabled ? 'plan_locked_and_not_enabled'
    : !planAllows ? 'plan_locked'
    : 'not_enabled'

  return { planAllows, workspaceEnabled, active, reason }
}
