/**
 * Workspace-level CRM connection identity.
 *
 * The integrations page used to render a single "LeadConnector ·
 * Connected" pill with no information about WHICH sub-account was
 * connected. When a single workspace ends up tied to multiple Locations
 * (this happens on reconnect or when an agency moves a sub-account
 * between workspaces) the operator had no way to tell which CRM was
 * actually wired up — they'd see "Connected" and have to dig through
 * the GHL UI to figure out the business name behind it.
 *
 * This module joins the workspace's `Location` rows against the
 * `MarketplaceInstall` snapshots written at OAuth time, returning a
 * per-connection record with the business name, company, address,
 * timezone, and installing user — everything we already capture but
 * weren't surfacing.
 *
 * Locations installed before the snapshot fetcher existed (May 25,
 * 2026) won't have a MarketplaceInstall row. We back-fill those lazily:
 * each call fires off a fetch-and-persist for any missing snapshot but
 * does NOT await it — the current request returns whatever data exists
 * now, the snapshot will be there next time.
 */

import { db } from '@/lib/db'
import { fetchInstallSnapshot } from '@/lib/leadconnector-install-fetcher'
import { writeMarketplaceInstall } from '@/lib/oauth-install'

export interface CrmConnectionDetail {
  /** GHL/HubSpot locationId (or whatever the CRM uses) — the row's id. */
  locationId: string
  /** 'ghl' | 'hubspot' — never 'native' or 'none' (those don't have install identity). */
  provider: string
  installedAt: string | null
  /** OAuth token expiry — useful so the UI can warn when a refresh is due. */
  tokenExpiresAt: string | null

  // Identity surfaced from MarketplaceInstall snapshot — all nullable
  // because the snapshot may have failed at install time (403 on
  // /companies/* is common) or pre-dates the snapshot fetcher.
  businessName: string | null
  businessEmail: string | null
  businessPhone: string | null
  businessWebsite: string | null
  businessAddress: string | null
  businessCity: string | null
  businessState: string | null
  businessCountry: string | null
  businessTimezone: string | null

  agencyName: string | null
  agencyWebsite: string | null

  installedByName: string | null
  installedByEmail: string | null
  installedByRole: string | null
}

/**
 * Build the per-connection list for a workspace's integrations page.
 * Returns one entry per real (non-native, non-placeholder) Location.
 * Fires off lazy MarketplaceInstall backfill for any Location that
 * doesn't have a snapshot yet; the backfill writes a row the next
 * call will see.
 */
export async function listCrmConnections(workspaceId: string): Promise<CrmConnectionDetail[]> {
  const locations = await db.location.findMany({
    where: {
      workspaceId,
      // Skip native + placeholder — they don't represent an external
      // install with an identity to surface.
      NOT: [
        { id: { startsWith: 'native:' } },
        { id: { startsWith: 'placeholder:' } },
      ],
      // A real install always has a token at some point. Disconnected
      // Locations are kept in the table with blank tokens; we still
      // surface them so operators can see "this WAS connected" with
      // the business name attached.
    },
    select: {
      id: true,
      crmProvider: true,
      installedAt: true,
      expiresAt: true,
      accessToken: true,
      companyId: true,
      userId: true,
    },
  })

  if (locations.length === 0) return []

  // Pull the most-recent snapshot per externalLocationId. A workspace
  // can collect multiple MarketplaceInstall rows per Location (each
  // reconnect writes a new one — that's intentional, it's a re-
  // engagement signal in the admin registry). For display we want the
  // freshest snapshot per location.
  let snapshots: Array<Record<string, any>> = []
  try {
    snapshots = await db.marketplaceInstall.findMany({
      where: {
        workspaceId,
        externalLocationId: { in: locations.map(l => l.id) },
      },
      orderBy: { installedAt: 'desc' },
    })
  } catch {
    // Table missing on un-migrated env — fall through with empty list.
  }

  const latestByLocation = new Map<string, Record<string, any>>()
  for (const row of snapshots) {
    const k = row.externalLocationId as string
    if (!latestByLocation.has(k)) latestByLocation.set(k, row)
  }

  const out: CrmConnectionDetail[] = []
  const backfillTargets: Array<{ location: typeof locations[number] }> = []

  for (const loc of locations) {
    const snap = latestByLocation.get(loc.id)
    out.push({
      locationId: loc.id,
      provider: loc.crmProvider,
      installedAt: loc.installedAt ? loc.installedAt.toISOString() : null,
      tokenExpiresAt: loc.expiresAt ? loc.expiresAt.toISOString() : null,

      businessName: (snap?.locationName as string | null) ?? null,
      businessEmail: (snap?.locationEmail as string | null) ?? null,
      businessPhone: (snap?.locationPhone as string | null) ?? null,
      businessWebsite: (snap?.locationWebsite as string | null) ?? null,
      businessAddress: (snap?.locationAddress as string | null) ?? null,
      businessCity: (snap?.locationCity as string | null) ?? null,
      businessState: (snap?.locationState as string | null) ?? null,
      businessCountry: (snap?.locationCountry as string | null) ?? null,
      businessTimezone: (snap?.locationTimezone as string | null) ?? null,

      agencyName: (snap?.companyName as string | null) ?? null,
      agencyWebsite: (snap?.companyWebsite as string | null) ?? null,

      installedByName: (snap?.userName as string | null) ?? null,
      installedByEmail: (snap?.userEmail as string | null) ?? null,
      installedByRole: (snap?.userRole as string | null) ?? null,
    })

    // Backfill candidate: a real GHL install with a live token but no
    // snapshot row yet. Pre-snapshot-fetcher installs (~before May 25,
    // 2026) and any install where the snapshot write failed silently.
    if (
      !snap &&
      loc.crmProvider === 'ghl' &&
      loc.accessToken &&
      loc.accessToken.length > 0
    ) {
      backfillTargets.push({ location: loc })
    }
  }

  // Fire-and-forget the backfill. We don't await — the integrations
  // page would block on a 300ms+ round-trip to GHL otherwise, and the
  // snapshot will be there the next time the page loads. Each fetch
  // is its own promise so a slow Companies fetch doesn't fail-fast
  // the others.
  if (backfillTargets.length > 0) {
    Promise.all(
      backfillTargets.map(async ({ location }) => {
        try {
          const snapshot = await fetchInstallSnapshot({
            accessToken: location.accessToken,
            locationId: location.id,
            companyId: location.companyId || null,
            userId: location.userId || null,
          })
          await writeMarketplaceInstall({
            workspaceId,
            // Only LeadConnector is in scope here — HubSpot doesn't use
            // this snapshot path. If we add Hubspot install snapshots
            // later, the source string will need to branch.
            source: 'ghl_marketplace',
            snapshot,
            externalLocationId: location.id,
            externalCompanyId: location.companyId || null,
            externalUserId: location.userId || null,
          })
        } catch (err: any) {
          // Non-fatal — the page already rendered without the data.
          console.warn(
            `[workspace-crm-connections] Backfill failed for location ${location.id}: ${err?.message}`,
          )
        }
      }),
    ).catch(() => {
      // The Promise.all wrapper itself can't really reject because each
      // map function swallows its own error, but catch defensively so
      // node doesn't log an unhandled rejection on a transient race.
    })
  }

  return out
}
