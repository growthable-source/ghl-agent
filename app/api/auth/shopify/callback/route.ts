/**
 * Shopify OAuth — callback
 *
 * GET /api/auth/shopify/callback?code=...&hmac=...&shop=...&state=...&timestamp=...
 *
 * Verification order matters — do it cheapest-first so a malicious
 * caller can't probe for which step we got to:
 *   1. shop is a valid *.myshopify.com domain (cheap, no secrets)
 *   2. our signed state token is valid (one HMAC, ours)
 *   3. Shopify's hmac param matches (one HMAC, theirs)
 *   4. exchange code for token (network round-trip)
 *
 * After token exchange we upsert ShopifyShop, then redirect the merchant
 * back to the integrations page. Webhook registration is a separate
 * concern handled in slice #3 — keeping this route narrow so the install
 * loop is debuggable end-to-end before we add side effects.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyOAuthCallbackHmac, verifyState } from '@/lib/commerce/shopify/hmac'
import { saveShopifyTokens } from '@/lib/commerce/shopify/token-store'

const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  // Helper: build an error redirect that lands on the integrations page
  // *if* we know the workspace, otherwise the dashboard root. We try to
  // recover workspaceId even on failure so the user lands somewhere
  // useful instead of staring at a JSON error blob.
  const verified = verifyState(searchParams.get('state'))
  const errBase = verified
    ? `/dashboard/${verified.workspaceId}/integrations`
    : '/dashboard'
  const errRedirect = (reason: string) =>
    NextResponse.redirect(new URL(`${errBase}?shopify=error&reason=${reason}`, req.url))

  // Shopify may bounce back with `error=access_denied` if the merchant
  // cancelled. Treat as a normal "back to integrations" exit.
  const oauthErr = searchParams.get('error')
  if (oauthErr) {
    console.warn('[Shopify OAuth] merchant declined:', oauthErr)
    return errRedirect(oauthErr === 'access_denied' ? 'cancelled' : 'oauth_error')
  }

  const shop = searchParams.get('shop')?.trim().toLowerCase() ?? ''
  const code = searchParams.get('code')

  // 1. shop shape
  if (!shop || !SHOP_DOMAIN.test(shop)) {
    console.warn('[Shopify OAuth] bad shop:', shop)
    return errRedirect('bad_shop')
  }

  // 2. our state
  if (!verified) {
    console.warn('[Shopify OAuth] state verify failed')
    return errRedirect('bad_state')
  }

  // 3. Shopify's hmac over the query string
  if (!verifyOAuthCallbackHmac(searchParams)) {
    console.warn('[Shopify OAuth] hmac verify failed for shop:', shop)
    return errRedirect('bad_hmac')
  }

  if (!code) {
    return errRedirect('missing_code')
  }

  // 4. exchange code -> access_token
  const clientId = process.env.SHOPIFY_API_KEY
  const clientSecret = process.env.SHOPIFY_API_SECRET
  if (!clientId || !clientSecret) {
    console.error('[Shopify OAuth] SHOPIFY_API_KEY/SECRET not configured')
    return errRedirect('not_configured')
  }

  let tokenJson: {
    access_token?: string
    scope?: string
    // Present only when the app is configured for expiring offline
    // tokens — which Shopify now requires as of 2026. We persist
    // these so the token store can refresh before the 24h lifetime
    // ends. Legacy non-expiring tokens (missing these fields) get
    // rejected by Shopify's API anyway, so there's no fallback path.
    expires_in?: number
    refresh_token?: string
  }
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        // Shopify defaults to non-expiring offline tokens which their
        // Admin API now refuses to honour (HTTP 403). Opt into the
        // expiring-token shape — the response gains `expires_in` +
        // `refresh_token` and our token store handles the rest.
        expiring: 1,
      }),
    })
    if (!tokenRes.ok) {
      const body = await tokenRes.text()
      console.error('[Shopify OAuth] token exchange failed:', tokenRes.status, body.slice(0, 500))
      return errRedirect('token_exchange_failed')
    }
    tokenJson = await tokenRes.json()
  } catch (err) {
    console.error('[Shopify OAuth] token exchange threw:', err)
    return errRedirect('token_exchange_threw')
  }

  if (!tokenJson.access_token) {
    console.error('[Shopify OAuth] token exchange returned no access_token:', tokenJson)
    return errRedirect('no_token')
  }

  // Refuse to persist a legacy non-expiring token — Shopify's API will
  // reject it on first use and the merchant will be stuck in a "looks
  // connected but doesn't work" state. Surface it now with a specific
  // error reason so the dashboard banner can guide them to fix the
  // Dev Dashboard app config (where the token-lifetime mode is set).
  if (!tokenJson.expires_in || !tokenJson.refresh_token) {
    console.error('[Shopify OAuth] non-expiring token returned — app is not configured for expiring offline tokens')
    return errRedirect('non_expiring_token')
  }

  try {
    await saveShopifyTokens({
      shop,
      workspaceId: verified.workspaceId,
      accessToken: tokenJson.access_token,
      scope: tokenJson.scope ?? '',
      expiresIn: tokenJson.expires_in ?? null,
      refreshToken: tokenJson.refresh_token ?? null,
    })

    // Register webhooks so the shop sends us inventory + uninstall
    // events. Best-effort — failure here doesn't fail the install
    // (the merchant is "connected" either way) but back-in-stock
    // pings won't work until webhooks land. Idempotent on Shopify's
    // side: duplicates return userErrors we treat as no-op.
    try {
      const { registerWebhooks } = await import('@/lib/commerce/shopify/webhooks')
      await registerWebhooks(shop, tokenJson.access_token)
    } catch (err) {
      console.error('[Shopify OAuth] webhook registration threw (non-fatal):', err)
    }

    // Voice assistants bake Shopify capability in at registration —
    // a connect AFTER registration leaves them without commerce
    // tools ("I can't access live stock data" despite a healthy
    // connection). Clear their assistant ids so the next call/save
    // re-registers with the store wired in.
    try {
      const { resyncWorkspaceVoiceAssistants } = await import('@/lib/voice/resync')
      await resyncWorkspaceVoiceAssistants(verified.workspaceId, 'shopify_connected')
    } catch (err) {
      console.error('[Shopify OAuth] voice resync threw (non-fatal):', err)
    }
  } catch (err) {
    console.error('[Shopify OAuth] token save failed:', err)
    return errRedirect('save_failed')
  }

  console.log(`[Shopify OAuth] connected shop=${shop} workspace=${verified.workspaceId}`)

  return NextResponse.redirect(
    new URL(
      `/dashboard/${verified.workspaceId}/integrations?shopify=connected&shop=${encodeURIComponent(shop)}`,
      req.url,
    ),
  )
}
