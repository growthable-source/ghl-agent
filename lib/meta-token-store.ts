/**
 * Storage + lookup for Meta integration credentials.
 *
 * Each connected Page lives as a separate `Integration` row keyed by
 * locationId, with `type='meta'` and a credentials blob shaped like:
 *
 *   {
 *     pageId: "1234567890",
 *     pageAccessToken: "EAA...",
 *     pageName: "Acme Inc",
 *     instagramBusinessAccountId?: "987...",  // present if linked
 *     // appSecret is NOT stored per-row — it's a single value for the
 *     // whole Meta App and lives in env vars (META_APP_SECRET).
 *     tokenIssuedAt: "2026-04-30T12:00:00Z",
 *     tokenExpiresAt: "2026-06-29T12:00:00Z" // ~60 days, optional.
 *   }
 *
 * Note: Page Access Tokens have no refresh path. When a token expires
 * (or is revoked) Graph returns 401, the verify endpoint flips the
 * Integration to isActive=false, and the operator must re-authorize.
 * That's a deliberate UX: silently rotating a token can hide the fact
 * that a Page was disconnected upstream.
 */

import { db } from './db'

export interface MetaCredentials {
  pageId: string
  pageAccessToken: string
  pageName?: string
  instagramBusinessAccountId?: string
  tokenIssuedAt?: string
  tokenExpiresAt?: string
}

export interface MetaIntegrationRow {
  id: string
  locationId: string
  isActive: boolean
  credentials: MetaCredentials
}

/**
 * Find the integration responsible for a Meta webhook entry. The webhook
 * payload's `entry[].id` is either a Facebook Page ID (Messenger
 * channel) or an Instagram Business Account ID (Instagram channel) —
 * we match against either field stored on the integration.
 *
 * Returns null when no integration matches OR when the matched row is
 * inactive (so a disconnected page silently drops messages instead of
 * trying to send with a dead token).
 */
export async function findMetaIntegrationByEntryId(
  entryId: string,
): Promise<MetaIntegrationRow | null> {
  // We use two indexed JSON-path queries because Postgres can't OR two
  // path conditions on the same column without a more complex predicate.
  // In practice each lookup is sub-ms with a small Integration table.
  const byPageId = await db.integration.findFirst({
    where: {
      type: 'meta',
      isActive: true,
      credentials: { path: ['pageId'], equals: entryId },
    },
  })
  if (byPageId) return toRow(byPageId)

  const byIgId = await db.integration.findFirst({
    where: {
      type: 'meta',
      isActive: true,
      credentials: { path: ['instagramBusinessAccountId'], equals: entryId },
    },
  })
  if (byIgId) return toRow(byIgId)

  return null
}

/**
 * Find every Meta integration in a workspace (via locationId →
 * workspaceId join). Used by the dashboard to render the connected
 * Pages list.
 */
export async function listMetaIntegrationsForLocation(locationId: string): Promise<MetaIntegrationRow[]> {
  const rows = await db.integration.findMany({
    where: { type: 'meta', locationId },
    orderBy: { createdAt: 'desc' },
  })
  return rows.map(toRow)
}

/**
 * Upsert one Page's credentials. Keyed by (locationId, pageId) so
 * re-authorizing the same Page on the same location refreshes the token
 * in place rather than spawning a duplicate row.
 */
export async function saveMetaIntegration(params: {
  locationId: string
  name: string
  credentials: MetaCredentials
}): Promise<MetaIntegrationRow> {
  const { locationId, name, credentials } = params

  const existing = await db.integration.findFirst({
    where: {
      type: 'meta',
      locationId,
      credentials: { path: ['pageId'], equals: credentials.pageId },
    },
  })

  if (existing) {
    const updated = await db.integration.update({
      where: { id: existing.id },
      data: {
        name,
        credentials: credentials as any,
        isActive: true,
      },
    })
    return toRow(updated)
  }

  const created = await db.integration.create({
    data: {
      type: 'meta',
      locationId,
      name,
      credentials: credentials as any,
      isActive: true,
    },
  })
  return toRow(created)
}

/**
 * Mark an integration inactive when Meta returns 401 / token revoked.
 * The dashboard surfaces a "reconnect Meta" banner from the inactive
 * state; we don't auto-retry because page tokens can't refresh silently.
 */
export async function deactivateMetaIntegration(integrationId: string, reason: string): Promise<void> {
  await db.integration.update({
    where: { id: integrationId },
    data: { isActive: false },
  }).catch(err => {
    console.warn(`[meta-token-store] failed to deactivate ${integrationId}:`, err?.message)
  })
  console.warn(`[meta-token-store] deactivated integration ${integrationId}: ${reason}`)
}

function toRow(row: any): MetaIntegrationRow {
  return {
    id: row.id,
    locationId: row.locationId,
    isActive: row.isActive,
    credentials: row.credentials as MetaCredentials,
  }
}
