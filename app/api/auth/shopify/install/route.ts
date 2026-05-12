/**
 * Shopify OAuth — install initiation
 *
 * GET /api/auth/shopify/install?shop=<shop>.myshopify.com&workspaceId=<id>
 *
 * Validates the `shop` domain shape, signs a CSRF state token that
 * binds the install to the requesting workspace, and redirects the
 * merchant to Shopify's authorize endpoint. Shopify then bounces back
 * to /api/auth/shopify/callback with a code + the same state.
 *
 * Two install entrypoints exist in the Shopify ecosystem:
 *   1. Merchant-initiated from our dashboard (this route, MVP).
 *   2. App-store-initiated — Shopify hits our App URL with `shop`,
 *      we forward to this route. Not wired yet; add when we list.
 *
 * We're using offline access mode (default — no `grant_options[]=`
 * in the URL). Online access tokens expire and would force a more
 * complex refresh dance that we don't need for server-side agents.
 */

import { NextRequest, NextResponse } from 'next/server'
import { signState } from '@/lib/commerce/shopify/hmac'

// Scopes requested at install time. Read scopes cover catalog + customer
// + order context for inventory-aware DMs; write scopes cover the
// transactional actions an agent will take (draft orders for checkout
// links, customer tag updates, discount code generation).
//
// Adding scopes later requires merchants to re-authorize — keep this
// list as the union of every scope we expect to need in the near term.
const SCOPES = [
  'read_products',
  'read_inventory',
  'read_orders',
  'write_draft_orders',
  'read_customers',
  'write_customers',
  'read_fulfillments',
  'read_returns',
  'read_price_rules',
  'write_discounts',
].join(',')

// Strict shop-domain validation. Shopify enforces this server-side
// too, but rejecting bad input here avoids a wasted round-trip and
// blocks the obvious SSRF vector of passing an arbitrary host.
const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const shop = searchParams.get('shop')?.trim().toLowerCase() ?? ''
  const workspaceId = searchParams.get('workspaceId')?.trim() ?? ''

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
  }
  if (!shop || !SHOP_DOMAIN.test(shop)) {
    return NextResponse.json(
      { error: 'shop must be a valid <name>.myshopify.com domain' },
      { status: 400 },
    )
  }

  const clientId = process.env.SHOPIFY_API_KEY
  if (!clientId) {
    return NextResponse.json({ error: 'Shopify OAuth not configured' }, { status: 500 })
  }

  // The redirect URI must match exactly what's registered in the Partner
  // dashboard. APP_URL is set per environment (prod=app.voxility.ai,
  // local=http://localhost:3000) so this resolves correctly in both.
  const appUrl = process.env.APP_URL || 'https://app.voxility.ai'
  const redirectUri = `${appUrl}/api/auth/shopify/callback`

  const state = signState(workspaceId)

  const authUrl = new URL(`https://${shop}/admin/oauth/authorize`)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('scope', SCOPES)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('state', state)
  // grant_options[] omitted -> offline access (long-lived token, no
  // refresh dance). Add 'per-user' only if we need online sessions.

  return NextResponse.redirect(authUrl.toString())
}
