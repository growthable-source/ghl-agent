/**
 * Workspace-scoped Shopify connection management.
 *
 * GET — connection status for the agent Knowledge tab's "Live data
 *   sources" panel. Returns { connected: false } when the workspace
 *   has no row OR the row is soft-uninstalled.
 *
 * DELETE — disconnect the Shopify store from this workspace.
 *   Marks `uninstalledAt` rather than deleting the row so we keep
 *   historical references intact (e.g. orders we already pulled into
 *   conversation context still know which shop they came from).
 *
 *   This does NOT revoke the access token with Shopify — Shopify does
 *   that itself when the merchant uninstalls from their admin, and
 *   uses the `app/uninstalled` webhook to tell us. So a "disconnect"
 *   from our UI is a soft local detach: we'll stop calling Shopify
 *   for this workspace, but the access token remains valid on
 *   Shopify's side until the merchant uninstalls there too.
 *
 *   Consider this a "pause" — if the same merchant re-runs the OAuth
 *   install flow we just overwrite the row and clear uninstalledAt.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { markShopifyUninstalled } from '@/lib/commerce/shopify/token-store'
import { db } from '@/lib/db'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET — connection-status check that honours **runtime** reality, not
 * just the presence of a row. Used by the agent Knowledge tab's "Live
 * data sources" panel.
 *
 * Three states:
 *   - connected:     row exists, runtime can fetch a valid token
 *   - needs_reconnect: row exists but the runtime check fails — most
 *                    often legacy rows created before Shopify's 2026
 *                    expiring-token rollout (refreshToken / expiresAt
 *                    are NULL). User must disconnect + reconnect to
 *                    refill the new columns.
 *   - not_connected: no row, or row is soft-uninstalled.
 *
 * Previously this endpoint reported `connected: true` for legacy rows
 * (it only checked uninstalledAt) — agents then failed silently at
 * tool-call time with `shopify_not_connected`. The panel was lying.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const row = await db.shopifyShop.findUnique({
    where: { workspaceId },
    select: { id: true, scope: true, installedAt: true, uninstalledAt: true },
  })
  if (!row || row.uninstalledAt) {
    return NextResponse.json({ connected: false, status: 'not_connected' })
  }

  // Runtime-truth check — the same getShopifyConnection the executor
  // uses. Returns null for legacy rows (no refreshToken/expiresAt) or
  // when a refresh attempt has failed.
  const { getShopifyConnection } = await import('@/lib/commerce/shopify/token-store')
  const runtime = await getShopifyConnection(workspaceId)
  if (!runtime) {
    return NextResponse.json({
      connected: false,
      status: 'needs_reconnect',
      shop: row.id,
      installedAt: row.installedAt,
    })
  }

  return NextResponse.json({
    connected: true,
    status: 'connected',
    shop: row.id,
    scope: row.scope,
    installedAt: row.installedAt,
  })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const row = await db.shopifyShop.findUnique({
    where: { workspaceId },
    select: { id: true, uninstalledAt: true },
  })
  if (!row) return NextResponse.json({ error: 'no_shopify_connection' }, { status: 404 })
  if (row.uninstalledAt) {
    // Idempotent: already disconnected. Treat as success so the UI
    // doesn't spook the user with an error on a second click.
    return NextResponse.json({ ok: true, shop: row.id, alreadyDisconnected: true })
  }

  await markShopifyUninstalled(row.id)
  return NextResponse.json({ ok: true, shop: row.id })
}
