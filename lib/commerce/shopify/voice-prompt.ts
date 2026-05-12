/**
 * Voice-call commerce context block.
 *
 * Voice agents can't yet call Shopify tools mid-call (XAI realtime
 * function calling is in flight — see follow-up issue). So instead of
 * pretending tools exist, this block tells the agent honestly:
 *
 *   - The workspace has a Shopify store connected
 *   - What shop domain it is
 *   - The customer profile (LTV + recent orders) if we recognise the caller
 *   - That live inventory / order lookups aren't possible on this call
 *   - To promise an SMS/email follow-up instead of guessing
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

  let block = `\n\n## Commerce (Shopify) — connected: ${conn.shop}\nThe workspace has a Shopify store linked. You're speaking on behalf of that store's merchant.\n\nIMPORTANT — limits during voice calls:\n- You CANNOT query live inventory, orders, customers, or generate checkout/discount codes during this call. Those tools are text-channel only for now.\n- If the caller asks about live stock, order status, or specific prices, do NOT guess or invent. Say you'll send the details by SMS or email after the call, then promise to follow up.\n- General store knowledge from your system prompt (what kinds of products you sell, store policies, return windows, etc.) is fair game — answer normally.\n- After the call you can use send_sms_followup to deliver the promised details.`

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
