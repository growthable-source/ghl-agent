/**
 * Shopify token store with refresh.
 *
 * Shopify rolled out expiring offline tokens in 2026 and the Admin
 * API now rejects non-expiring tokens with HTTP 403. So:
 *
 *   - The OAuth callback now persists `refreshToken` + `expiresAt`
 *     alongside the access token.
 *   - `getValidShopifyConnection(workspaceId)` checks `expiresAt`
 *     and refreshes BEFORE returning if we're within `EXPIRY_BUFFER`
 *     of expiry (or already past).
 *   - Refresh is single-flight per shop so concurrent tool calls
 *     don't race and burn through Shopify's refresh-token rotation.
 *
 * Rows created before the schema change have NULL refreshToken /
 * expiresAt. Those are unusable now — we return null from the
 * connection lookup so the dispatcher tells the agent
 * "shopify_not_connected" instead of trying the rejected token. The
 * fix is a fresh OAuth reconnect, which fills in the new columns.
 */

import { db } from '@/lib/db'

// Refresh proactively when the token has less than 5 minutes left.
// Shopify's stated lifetime is 24h so this gives plenty of headroom;
// the only reason to widen it is if tool calls regularly take longer
// than 5 minutes, which they don't.
const EXPIRY_BUFFER_MS = 5 * 60 * 1000

export interface ShopifyTokenSaveInput {
  shop: string
  workspaceId: string
  accessToken: string
  scope: string
  /** Lifetime in seconds from the token response. Null/undefined for legacy non-expiring tokens (now rejected by Shopify). */
  expiresIn?: number | null
  /** Refresh token from the token response. Null/undefined for legacy non-expiring tokens. */
  refreshToken?: string | null
}

export async function saveShopifyTokens(input: ShopifyTokenSaveInput): Promise<void> {
  const { shop, workspaceId, accessToken, scope, expiresIn, refreshToken } = input
  const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null
  await db.shopifyShop.upsert({
    where: { id: shop },
    create: {
      id: shop,
      workspaceId,
      accessToken,
      scope,
      refreshToken: refreshToken ?? null,
      expiresAt,
      uninstalledAt: null,
    },
    update: {
      workspaceId,
      accessToken,
      scope,
      refreshToken: refreshToken ?? null,
      expiresAt,
      uninstalledAt: null,
    },
  })
}

export async function markShopifyUninstalled(shop: string): Promise<void> {
  await db.shopifyShop.updateMany({
    where: { id: shop, uninstalledAt: null },
    data: { uninstalledAt: new Date() },
  })
}

export interface ShopifyConnection {
  shop: string
  accessToken: string
  scope: string
}

/**
 * Workspace-scoped lookup that auto-refreshes a near-expiry token
 * before returning. Returns null when:
 *   - no row exists or it's marked uninstalled
 *   - the row predates the expiring-token migration (no refreshToken)
 *   - the refresh attempt failed
 *
 * Tool dispatchers should treat null as "no Shopify, fall back
 * gracefully" — they already do via the shopify_not_connected hint.
 */
export async function getShopifyConnection(workspaceId: string): Promise<ShopifyConnection | null> {
  const row = await db.shopifyShop.findUnique({
    where: { workspaceId },
    select: {
      id: true,
      accessToken: true,
      scope: true,
      refreshToken: true,
      expiresAt: true,
      uninstalledAt: true,
    },
  })
  if (!row || row.uninstalledAt) return null

  // Legacy row: no refresh capability. Token is presumed non-expiring,
  // which Shopify now rejects. Force a reconnect.
  if (!row.refreshToken || !row.expiresAt) {
    console.warn(`[Shopify] shop ${row.id} has no refresh_token — needs OAuth reconnect`)
    return null
  }

  const expiresInMs = row.expiresAt.getTime() - Date.now()
  if (expiresInMs > EXPIRY_BUFFER_MS) {
    return { shop: row.id, accessToken: row.accessToken, scope: row.scope }
  }

  // Past the buffer — refresh before returning.
  const refreshed = await refreshShopifyToken(row.id, row.refreshToken)
  if (!refreshed) return null
  return { shop: row.id, accessToken: refreshed.accessToken, scope: row.scope }
}

/**
 * Webhook lookup path — keyed by shop domain (the only id a webhook
 * payload carries). Same refresh semantics as the workspace lookup.
 * Throws on missing/uninstalled because webhook handlers don't have a
 * graceful fallback the way the agent dispatcher does.
 */
export async function getShopifyTokenByShop(shop: string): Promise<string> {
  const row = await db.shopifyShop.findUnique({
    where: { id: shop },
    select: { accessToken: true, refreshToken: true, expiresAt: true, uninstalledAt: true },
  })
  if (!row) throw new Error(`shopify: no shop record for ${shop}`)
  if (row.uninstalledAt) throw new Error(`shopify: shop ${shop} is uninstalled`)
  if (!row.refreshToken || !row.expiresAt) {
    throw new Error(`shopify: shop ${shop} has no refresh_token — reconnect required`)
  }

  const expiresInMs = row.expiresAt.getTime() - Date.now()
  if (expiresInMs > EXPIRY_BUFFER_MS) return row.accessToken

  const refreshed = await refreshShopifyToken(shop, row.refreshToken)
  if (!refreshed) throw new Error(`shopify: refresh failed for ${shop}`)
  return refreshed.accessToken
}

// ─── Refresh, with single-flight ─────────────────────────────────────
//
// If two tool calls hit the same shop while the token is expired, the
// first refresh rotates the refresh_token; the second would arrive
// with the now-invalid old refresh_token and Shopify would burn the
// whole grant. The promise-cache pattern (copied from GHL's
// token-store) ensures concurrent callers await the same in-flight
// refresh.
//
// Cache lives on the module (memoised per Node process). Vercel
// functions are short-lived but within one invocation we can serve
// many tool calls — that's where the cache pays off.

const inflight = new Map<string, Promise<{ accessToken: string; expiresAt: Date } | null>>()

async function refreshShopifyToken(
  shop: string,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date } | null> {
  const existing = inflight.get(shop)
  if (existing) return existing

  const p = doRefresh(shop, refreshToken).finally(() => {
    inflight.delete(shop)
  })
  inflight.set(shop, p)
  return p
}

async function doRefresh(
  shop: string,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: Date } | null> {
  const clientId = process.env.SHOPIFY_API_KEY
  const clientSecret = process.env.SHOPIFY_API_SECRET
  if (!clientId || !clientSecret) {
    console.error('[Shopify refresh] missing SHOPIFY_API_KEY or SHOPIFY_API_SECRET')
    return null
  }

  try {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error(`[Shopify refresh] ${shop} failed: ${res.status} ${body.slice(0, 300)}`)
      // 400/401: refresh_token is dead — Shopify won't recover it. Clear
      // the row's refresh state so callers get a clean "needs reconnect"
      // signal next call instead of looping. Keep accessToken untouched
      // so the disconnect UI still shows the shop name.
      if (res.status === 400 || res.status === 401) {
        try {
          await db.shopifyShop.update({
            where: { id: shop },
            data: { refreshToken: null, expiresAt: null },
          })
        } catch (err) {
          console.error('[Shopify refresh] could not clear dead refresh_token:', err)
        }
      }
      return null
    }
    const json = (await res.json()) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      scope?: string
    }
    if (!json.access_token || !json.expires_in) {
      console.error(`[Shopify refresh] ${shop} returned malformed token response`)
      return null
    }
    const expiresAt = new Date(Date.now() + json.expires_in * 1000)
    await db.shopifyShop.update({
      where: { id: shop },
      data: {
        accessToken: json.access_token,
        // Shopify rotates the refresh_token on every refresh — persist
        // the new one or the next refresh will fail.
        refreshToken: json.refresh_token ?? refreshToken,
        expiresAt,
        // Scope can change if the merchant accepted additional scopes
        // during a reauth; persist if returned, otherwise leave the
        // existing column alone (caller has the prior value).
        ...(json.scope ? { scope: json.scope } : {}),
      },
    })
    return { accessToken: json.access_token, expiresAt }
  } catch (err) {
    console.error(`[Shopify refresh] ${shop} threw:`, err)
    return null
  }
}
