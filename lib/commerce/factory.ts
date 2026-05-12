/**
 * Commerce adapter factory.
 *
 * Returns a ShopifyAdapter bound to the workspace's connected shop, or
 * null when no shop is connected (or the shop was uninstalled). Tool
 * dispatchers should treat null as "this workspace doesn't have
 * commerce wired up" and return a friendly message to the model
 * instead of throwing — the LLM should be allowed to discover that an
 * action isn't available and fall back gracefully.
 *
 * One adapter per workspace, instantiated on demand. We don't pool —
 * the constructor is cheap (just stores the shop+token) and stateless
 * across requests.
 */

import { getShopifyConnection } from './shopify/token-store'
import { ShopifyAdapter } from './shopify/adapter'

export async function getCommerceAdapter(workspaceId: string): Promise<ShopifyAdapter | null> {
  const conn = await getShopifyConnection(workspaceId)
  if (!conn) return null
  return new ShopifyAdapter({ shop: conn.shop, accessToken: conn.accessToken })
}
