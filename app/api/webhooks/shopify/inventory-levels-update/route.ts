/**
 * Shopify webhook — inventory_levels/update
 *
 * Fires on ANY inventory change (not just OOS → in-stock), so we have
 * to filter: only act when `available > 0` AND we have unnotified
 * interest signals for the affected variant. Notified signals are
 * marked so a subsequent restock-then-restock-again doesn't re-DM the
 * same customer.
 *
 * Outbound delivery is widget-only for now (writes a WidgetMessage +
 * SSE broadcasts). Adding Meta/SMS channels later is just more
 * `channel === 'foo'` branches — the signal table already carries the
 * channel.
 *
 * Always returns 200 (after HMAC verify) so Shopify doesn't retry on
 * our internal failures. We log + move on; the worst case is one
 * missed restock ping, not a stuck merchant.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookHmac } from '@/lib/commerce/shopify/hmac'
import { db } from '@/lib/db'
import { ShopifyAdapter } from '@/lib/commerce/shopify/adapter'
import { broadcast } from '@/lib/widget-sse'

export async function POST(req: NextRequest) {
  // Read raw body BEFORE parsing — HMAC is computed over the exact
  // bytes Shopify sent.
  const rawBody = await req.text()
  const hmac = req.headers.get('x-shopify-hmac-sha256')
  const shop = req.headers.get('x-shopify-shop-domain')?.toLowerCase()

  if (!shop) {
    console.warn('[Shopify webhook] inventory: missing shop header')
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  if (!verifyWebhookHmac(rawBody, hmac)) {
    console.warn(`[Shopify webhook] inventory: HMAC verify failed for ${shop}`)
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  // Parse payload AFTER HMAC verify
  let payload: { inventory_item_id?: number; available?: number; location_id?: number }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    console.warn(`[Shopify webhook] inventory: bad JSON from ${shop}`)
    return NextResponse.json({ ok: true })
  }
  const { inventory_item_id, available } = payload
  if (typeof inventory_item_id !== 'number' || typeof available !== 'number') {
    return NextResponse.json({ ok: true })
  }

  // Only act on restocks (available > 0). Other inventory wiggles are
  // ignored — we don't care about stock going down or staying low.
  if (available <= 0) {
    return NextResponse.json({ ok: true })
  }

  // We need the shop's token to resolve inventory_item_id → variant.
  const shopRow = await db.shopifyShop.findUnique({
    where: { id: shop },
    select: { accessToken: true, refreshToken: true, expiresAt: true, uninstalledAt: true },
  })
  if (!shopRow || shopRow.uninstalledAt) {
    return NextResponse.json({ ok: true })
  }

  // Use the token store's refresh-if-needed path. Webhooks can fire at
  // any time, including across token-expiry boundaries.
  const { getShopifyTokenByShop } = await import('@/lib/commerce/shopify/token-store')
  let accessToken: string
  try {
    accessToken = await getShopifyTokenByShop(shop)
  } catch (err: any) {
    console.warn(`[Shopify webhook] inventory: token unavailable for ${shop}: ${err?.message}`)
    return NextResponse.json({ ok: true })
  }

  const shopAdapter = new ShopifyAdapter({ shop, accessToken })

  let variant: { variantId: string; productTitle: string; variantTitle: string; productHandle: string } | null = null
  try {
    variant = await shopAdapter.getVariantByInventoryItemId(inventory_item_id)
  } catch (err: any) {
    console.warn(`[Shopify webhook] inventory: variant lookup failed: ${err?.message}`)
    return NextResponse.json({ ok: true })
  }
  if (!variant) {
    return NextResponse.json({ ok: true })
  }

  // Find unnotified interest signals for this variant on this shop.
  const signals = await db.shopifyInterestSignal.findMany({
    where: {
      shopId: shop,
      variantId: variant.variantId,
      notifiedAt: null,
    },
    select: { id: true, channel: true, conversationId: true, productTitle: true, variantTitle: true },
  })
  if (signals.length === 0) {
    return NextResponse.json({ ok: true })
  }

  const productUrl = `https://${shop}/products/${variant.productHandle}`

  for (const sig of signals) {
    try {
      if (sig.channel === 'widget') {
        const variantSuffix = sig.variantTitle ? ` (${sig.variantTitle})` : ''
        const text = `Good news — ${sig.productTitle}${variantSuffix} is back in stock! You can grab it here: ${productUrl}`
        const msg = await db.widgetMessage.create({
          data: {
            conversationId: sig.conversationId,
            role: 'agent',
            content: text,
            kind: 'text',
          },
        })
        await db.widgetConversation.update({
          where: { id: sig.conversationId },
          data: { lastMessageAt: new Date() },
        }).catch(() => { /* conversation may have been deleted */ })
        await broadcast(sig.conversationId, {
          type: 'agent_message',
          id: msg.id,
          content: text,
          createdAt: msg.createdAt.toISOString(),
        }).catch(() => { /* no live subscribers, that's fine — the message will be picked up on next reconnect */ })
      } else {
        // Other channels (meta, sms) — TODO. Skip silently; the signal
        // stays unnotified so we'll try again on the next webhook,
        // which is fine for now (most variants don't restock multiple
        // times in quick succession).
        console.warn(`[Shopify webhook] inventory: channel ${sig.channel} outbound not yet implemented (signal ${sig.id})`)
        continue
      }

      await db.shopifyInterestSignal.update({
        where: { id: sig.id },
        data: { notifiedAt: new Date() },
      })
    } catch (err: any) {
      console.error(`[Shopify webhook] inventory: signal ${sig.id} delivery failed: ${err?.message}`)
    }
  }

  return NextResponse.json({ ok: true })
}
