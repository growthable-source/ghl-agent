/**
 * Voice-call commerce context block.
 *
 * Injected into voice-agent system prompts when the workspace has a
 * Shopify store connected. Tells the agent:
 *
 *   - Which shop is linked
 *   - The Shopify tools available for live calls (search products,
 *     check inventory, look up the caller, check order status, mint
 *     discounts, capture back-in-stock interest, create checkouts)
 *   - The customer profile (LTV + recent orders) if we recognise the
 *     caller by email/phone
 *   - Voice-call etiquette — short answers, no URLs aloud, use
 *     send_sms_followup for anything URL-shaped
 *
 * Returns empty string when no shop is connected — caller appends
 * unconditionally and gets a no-op when commerce isn't relevant.
 */

import { getShopifyConnection } from './token-store'
import { ShopifyAdapter } from './adapter'

export async function buildVoiceCommerceBlock(args: {
  workspaceId: string | null
  /** Optional caller email/phone for customer hydration. */
  callerEmail?: string | null
  callerPhone?: string | null
}): Promise<string> {
  if (!args.workspaceId) return ''
  let conn: { shop: string; accessToken: string } | null = null
  try {
    conn = await getShopifyConnection(args.workspaceId)
  } catch {
    return ''
  }
  if (!conn) return ''

  let block = `\n\n## Commerce (Shopify) — connected: ${conn.shop}\nThe workspace has a Shopify store linked. You're speaking on behalf of that store's merchant.\n\nYou CAN call Shopify tools live during this voice call:\n- search_shopify_products — quote live prices, variants, stock\n- check_shopify_inventory — exact stock for a variant\n- lookup_shopify_customer — pull up the caller's purchase history\n- check_shopify_order_status — "where's my order" → live fulfilment + tracking\n- create_shopify_checkout — text-back a checkout link (use send_sms_followup to deliver, since voice can't paste URLs)\n- create_shopify_discount — mint a code; SAY it aloud clearly ("the code is H, E, L, L, O, 1, 0")\n- record_back_in_stock_interest — capture an OOS variant interest\n\nVoice-call tool etiquette:\n- Before a tool call, say a single beat: "let me check that for you" / "one sec, looking that up." Silence while a call runs sounds dead.\n- Keep replies short (1–3 sentences). Don't read out URLs or long IDs — promise an SMS via send_sms_followup instead.\n- If a tool returns shopify_not_connected, say you can't access live store data right now and offer to escalate.\n- NEVER invent product details, prices, stock, or order status. If a tool says "not found," tell the caller that honestly.`

  // Customer hydration — agent knows who's calling.
  if (args.callerEmail || args.callerPhone) {
    try {
      const adapter = new ShopifyAdapter({ shop: conn.shop, accessToken: conn.accessToken })
      const customer = await adapter.findCustomer({
        email: args.callerEmail ?? undefined,
        phone: args.callerPhone ?? undefined,
      })
      if (customer) {
        const name = [customer.firstName, customer.lastName].filter(Boolean).join(' ') || 'unknown name'
        const ltv = customer.lifetimeSpend
          ? `${customer.lifetimeSpend.amount} ${customer.lifetimeSpend.currency}`
          : 'unknown'
        const lastOrder = customer.recentOrders[0]
        const lastOrderLine = lastOrder
          ? `Most recent order: ${lastOrder.name} (${(lastOrder.processedAt || '').slice(0, 10)}, ${lastOrder.total.amount} ${lastOrder.total.currency}, ${lastOrder.fulfillmentStatus || 'status unknown'})`
          : 'No prior orders.'
        block += `\n\n### Known caller (from Shopify)\nName: ${name}\nLifetime: ${customer.numberOfOrders} orders, ${ltv} total\n${lastOrderLine}\n\nGreet them warmly — they're a known customer. Don't recite the details back; use them to set the tone ("welcome back" etc).`
      }
    } catch {
      // Customer hydration is a nice-to-have, never block the call.
    }
  }

  return block
}
