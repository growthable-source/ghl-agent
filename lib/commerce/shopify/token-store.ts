/**
 * Shopify token store.
 *
 * Much simpler than the GHL token store: Shopify offline access tokens
 * do NOT expire and they're NOT rotated on use. So we just upsert on
 * install, soft-delete (set uninstalledAt) when the app/uninstalled
 * webhook fires, and hard-throw if a caller asks for a missing or
 * uninstalled shop's token.
 *
 * If we ever start using session tokens (online access mode) we'll
 * need to add expiry + refresh handling separately — keep that out of
 * here for now.
 */

import { db } from '@/lib/db'

export interface ShopifyTokenSaveInput {
  shop: string // canonical *.myshopify.com domain
  workspaceId: string
  accessToken: string
  scope: string
}

/**
 * Upsert on install. If a workspace re-installs (same shop, same
 * workspace) we overwrite the access token + scope and clear
 * uninstalledAt so reads succeed again.
 *
 * If the shop was previously installed against a DIFFERENT workspace,
 * we rebind it — the install flow ran under the new workspace's
 * session, so that workspace now owns the shop. This matches the GHL
 * re-install behaviour.
 */
export async function saveShopifyTokens(input: ShopifyTokenSaveInput): Promise<void> {
  const { shop, workspaceId, accessToken, scope } = input
  await db.shopifyShop.upsert({
    where: { id: shop },
    create: { id: shop, workspaceId, accessToken, scope, uninstalledAt: null },
    update: { workspaceId, accessToken, scope, uninstalledAt: null },
  })
}

/**
 * Mark a shop as uninstalled. Called from the app/uninstalled webhook.
 * We don't delete the row — keeping it around lets the dashboard show
 * "Reconnect" instead of "Connect" on the same shop, and preserves
 * any historical references.
 */
export async function markShopifyUninstalled(shop: string): Promise<void> {
  await db.shopifyShop.updateMany({
    where: { id: shop, uninstalledAt: null },
    data: { uninstalledAt: new Date() },
  })
}

/**
 * Lookup access token by shop domain (webhook handlers know shop, not
 * workspaceId). Throws if missing/uninstalled — callers should not
 * try to be clever about a "maybe valid" token.
 */
export async function getShopifyTokenByShop(shop: string): Promise<string> {
  const row = await db.shopifyShop.findUnique({
    where: { id: shop },
    select: { accessToken: true, uninstalledAt: true },
  })
  if (!row) throw new Error(`shopify: no shop record for ${shop}`)
  if (row.uninstalledAt) throw new Error(`shopify: shop ${shop} is uninstalled`)
  return row.accessToken
}

/**
 * Lookup by workspace (the common case for dashboard + agent calls,
 * which know their workspace). Returns null instead of throwing because
 * "no shop connected yet" is a normal UI state, not an error.
 */
export async function getShopifyConnection(workspaceId: string): Promise<{
  shop: string
  accessToken: string
  scope: string
} | null> {
  const row = await db.shopifyShop.findUnique({
    where: { workspaceId },
    select: { id: true, accessToken: true, scope: true, uninstalledAt: true },
  })
  if (!row || row.uninstalledAt) return null
  return { shop: row.id, accessToken: row.accessToken, scope: row.scope }
}
