/**
 * Shopify webhook — app/uninstalled
 *
 * Fires when a merchant uninstalls our app from their Shopify admin.
 * We mark the shop row with uninstalledAt so future tool calls report
 * shopify_not_connected, and the integrations page UI flips back to
 * "Connect."
 *
 * Always 200 after HMAC verify so Shopify doesn't retry. If our DB
 * is down we'll catch the uninstall on the next install attempt
 * (which overwrites the row and clears uninstalledAt).
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyWebhookHmac } from '@/lib/commerce/shopify/hmac'
import { markShopifyUninstalled } from '@/lib/commerce/shopify/token-store'

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const hmac = req.headers.get('x-shopify-hmac-sha256')
  const shop = req.headers.get('x-shopify-shop-domain')?.toLowerCase()

  if (!shop) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  if (!verifyWebhookHmac(rawBody, hmac)) {
    console.warn(`[Shopify webhook] uninstall: HMAC verify failed for ${shop}`)
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  try {
    // Resolve workspace BEFORE marking uninstalled (the row survives —
    // soft uninstall — but grab it while we're here for the resync).
    const { db } = await import('@/lib/db')
    const row = await db.shopifyShop.findUnique({ where: { id: shop }, select: { workspaceId: true } })

    await markShopifyUninstalled(shop)
    console.log(`[Shopify webhook] uninstall recorded for ${shop}`)

    if (row?.workspaceId) {
      const { resyncWorkspaceVoiceAssistants } = await import('@/lib/voice/resync')
      await resyncWorkspaceVoiceAssistants(row.workspaceId, 'shopify_app_uninstalled')
    }
  } catch (err: any) {
    console.error(`[Shopify webhook] uninstall: markShopifyUninstalled failed for ${shop}: ${err?.message}`)
  }

  return NextResponse.json({ ok: true })
}
