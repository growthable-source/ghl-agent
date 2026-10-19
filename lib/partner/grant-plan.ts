import { db } from '@/lib/db'
import { getPlanDefaults } from '@/lib/plans'

/**
 * Every Growthable plan grants the full internal capability set — the
 * Growthable plan id is the commercial fact we record, Xovera 'scale'
 * is an implementation detail of our own support engine.
 */
export const XOVERA_PLAN = 'scale'

/**
 * Comp a workspace onto the full capability set: writes the plan +
 * defaults, clears the trial clock, turns ticketing on. Deliberately
 * never touches stripe* fields — no Stripe rows is how support tells
 * manually-granted workspaces apart from Xovera-billed ones.
 *
 * Shared by the help-centre install unlock and the Workspaces-tab
 * "Set plan" control so both paths grant exactly the same thing.
 */
export async function grantWorkspacePlan(workspaceId: string): Promise<void> {
  await db.workspace.update({
    where: { id: workspaceId },
    data: {
      plan: XOVERA_PLAN,
      ...getPlanDefaults(XOVERA_PLAN),
      trialEndsAt: null,
      planSelectedDuringTrial: null,
    },
  })
  // These customers can't reach the settings page to flip ticketing
  // themselves, so it is part of every grant.
  await db.ticketingSettings.upsert({
    where: { workspaceId },
    create: { workspaceId, enabled: true },
    update: { enabled: true },
  })
}
