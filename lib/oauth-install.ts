/**
 * Helpers extracted from the LeadConnector OAuth callback at
 * app/api/auth/callback/route.ts. The callback orchestrates a handful
 * of mostly-independent steps:
 *
 *   1. Exchange code for tokens         (stays in the route)
 *   2. Pull install metadata             (lib/leadconnector-install-fetcher)
 *   3. Upsert the Location               (stays in the route — close to
 *                                         the redirect/state branching
 *                                         logic that needs the result)
 *   4. Cascade agents to workspace       ← here
 *   5. Snapshot the install in registry  ← here
 *   6. Derive a workspace name + slug    ← here
 *   7. Branch + redirect                 (stays in the route)
 *
 * Pulling 4–6 out makes each step testable in isolation and stops a
 * regression in any one of them from being buried inside a 350-line
 * try/catch chain.
 */

import { db } from '@/lib/db'
import type { InstallSnapshot } from '@/lib/leadconnector-install-fetcher'

/**
 * Re-binds every Agent whose Location is `locationId` to the given
 * workspace. Used when a marketplace install moves a Location to a new
 * workspace — without it, agents tagged to the previous workspace
 * still fire on inbounds for the new workspace ("ghost agent" bug).
 *
 * Non-fatal: install completes even if this fails. Logged so operators
 * can investigate without breaking the user's reconnect.
 */
export async function cascadeAgentsToWorkspace(
  locationId: string,
  workspaceId: string,
): Promise<void> {
  try {
    const cascade = await db.agent.updateMany({
      where: { locationId, NOT: { workspaceId } },
      data: { workspaceId },
    })
    if (cascade.count > 0) {
      console.log(`[OAuth] Re-bound ${cascade.count} agent(s) on location ${locationId} to workspace ${workspaceId}`)
    }
  } catch (err: any) {
    console.warn(`[OAuth] Agent cascade failed for location ${locationId}: ${err?.message}`)
  }
}

/**
 * Writes one MarketplaceInstall row per install event. Reconnects
 * create a new row (treated as a re-engagement signal in the admin
 * registry). Snapshot fields that came back null stay null — the
 * admin UI handles missing data.
 *
 * Non-fatal: install completes even if the table is missing on an
 * un-migrated DB.
 */
export async function writeMarketplaceInstall(opts: {
  workspaceId: string
  source: string
  snapshot: InstallSnapshot | null
  externalLocationId: string | null
  externalCompanyId: string | null
  externalUserId: string | null
}): Promise<void> {
  const { workspaceId, source, snapshot } = opts
  if (!snapshot) return
  try {
    await db.marketplaceInstall.create({
      data: {
        workspaceId,
        source,
        externalLocationId: opts.externalLocationId,
        externalCompanyId: opts.externalCompanyId,
        externalUserId: opts.externalUserId,
        locationName: snapshot.location?.name ?? null,
        locationEmail: snapshot.location?.email ?? null,
        locationPhone: snapshot.location?.phone ?? null,
        locationWebsite: snapshot.location?.website ?? null,
        locationAddress: snapshot.location?.address ?? null,
        locationCity: snapshot.location?.city ?? null,
        locationState: snapshot.location?.state ?? null,
        locationCountry: snapshot.location?.country ?? null,
        locationTimezone: snapshot.location?.timezone ?? null,
        companyName: snapshot.company?.name ?? null,
        companyEmail: snapshot.company?.email ?? null,
        companyPhone: snapshot.company?.phone ?? null,
        companyWebsite: snapshot.company?.website ?? null,
        userName: snapshot.user?.name ?? null,
        userEmail: snapshot.user?.email ?? null,
        userPhone: snapshot.user?.phone ?? null,
        userRole: snapshot.user?.role ?? null,
        rawPayload: snapshot.raw as any,
      },
    })
  } catch (err: any) {
    console.warn('[OAuth] MarketplaceInstall write skipped:', err?.message)
  }
}

/**
 * URL-safe slug for the auto-named workspace created on first
 * marketplace install. Prefix prevents collision with direct-signup
 * slugs (which use the workspace name); the random suffix avoids
 * unique-constraint races between concurrent installs on the same
 * locationId.
 */
export function workspaceSlugFromLocation(locationId: string): string {
  const prefix = locationId.slice(0, 12).toLowerCase().replace(/[^a-z0-9]/g, '')
  const suffix = Math.random().toString(36).slice(2, 8)
  return `ws-${prefix}-${suffix}`
}

/**
 * Derives the auto-named workspace name + domain from the install
 * snapshot. Falls back to "Workspace" + null when GHL didn't grant
 * locations.readonly / the call failed.
 */
export function workspaceNameFromSnapshot(snapshot: InstallSnapshot | null): {
  name: string
  domain: string | null
} {
  const name = snapshot?.location?.name ?? snapshot?.company?.name ?? 'Workspace'
  const rawWebsite = snapshot?.location?.website ?? snapshot?.company?.website ?? null
  let domain: string | null = null
  if (rawWebsite) {
    try {
      domain = new URL(rawWebsite.startsWith('http') ? rawWebsite : `https://${rawWebsite}`)
        .hostname.replace(/^www\./, '')
    } catch {
      domain = null
    }
  }
  return { name, domain }
}
