/**
 * Funnel-side CRM locator
 *
 * Form submissions on a Xovera landing page need to land in a CRM. The
 * landing page belongs to a Workspace; it MAY be tied to a Campaign which
 * MAY be tied to a Location (GHL/HubSpot). When no Location is set, fall
 * back to the workspace's first Location with a usable crmProvider, or
 * the synthetic `native:<workspaceId>` locationId if the workspace runs
 * the native CRM.
 *
 * Order of preference for a campaign-attached page:
 *   1. campaign.location.id  (explicit override on the campaign)
 *   2. workspace's first non-placeholder Location with a real crmProvider
 *   3. `native:<workspaceId>`  (synthetic — NativeAdapter)
 *
 * For a standalone landing page (no campaign): same fallback chain
 * starting from step 2.
 */

import { db } from '@/lib/db'

export async function resolveCrmLocationId(args: {
  workspaceId: string
  campaignLocationId?: string | null
}): Promise<string> {
  if (args.campaignLocationId) return args.campaignLocationId

  // Workspace's first real Location with a usable provider. Skip
  // placeholder locations (those exist when the workspace built an agent
  // before connecting any CRM).
  const location = await db.location.findFirst({
    where: {
      workspaceId: args.workspaceId,
      NOT: { id: { startsWith: 'placeholder:' } },
    },
    select: { id: true, crmProvider: true },
    orderBy: { installedAt: 'asc' },
  })

  if (location && location.crmProvider !== 'none') return location.id

  // Native fallback. The factory short-circuits this prefix and returns
  // NativeAdapter without a Location row lookup, so it's safe even when
  // the workspace has no Location at all.
  return `native:${args.workspaceId}`
}
