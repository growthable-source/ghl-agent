/**
 * Webhook Event Receiver
 * POST /api/webhooks/events
 * 
 * Receives all events from the Marketplace app:
 *  - INSTALL       → save initial token context
 *  - InboundMessage → trigger AI agent
 *  - Other events   → log / handle as needed
 */

import { NextRequest, NextResponse } from 'next/server'
import { getTokens } from '@/lib/token-store'
import { getMessages } from '@/lib/crm-client'
import { runAgent } from '@/lib/ai-agent'
import type {
  WebhookEventType,
  WebhookInstallPayload,
  WebhookMessagePayload,
} from '@/types'

// ─── Optional: verify webhook signature ───────────────────────────────────

function verifySignature(req: NextRequest, rawBody: string): boolean {
  const secret = process.env.WEBHOOK_SECRET
  if (!secret) return true // Skip if not configured
  const signature = req.headers.get('x-webhook-signature')
  // Implement HMAC verification here if your provider sends signatures
  return true
}

// ─── Handler ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  if (!verifySignature(req, rawBody)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType: WebhookEventType = payload.type

  console.log(`[Webhook] Received event: ${eventType}`)

  try {
    switch (eventType) {

      // ── App installed ──────────────────────────────────────────────────
      case 'INSTALL': {
        const p = payload as WebhookInstallPayload
        console.log(`[Webhook] App installed at location: ${p.locationId} (${p.companyName})`)
        // Tokens are saved via the OAuth callback — this is just for logging/setup
        // You could trigger a welcome SMS here
        break
      }

      // ── Inbound SMS ────────────────────────────────────────────────────
      case 'InboundMessage': {
        const p = payload as WebhookMessagePayload

        // Only handle SMS for now
        if (p.messageType !== 'SMS') break

        // Check if auto-reply is enabled for this location
        const tokens = getTokens(p.locationId)
        if (!tokens) {
          console.warn(`[Webhook] No tokens for location ${p.locationId}`)
          break
        }

        // Fetch recent message history for context
        let history: import('@/types').Message[]
        try {
          history = await getMessages(p.locationId, p.conversationId, 10)
        } catch {
          history = []
        }

        // Run the AI agent
        const result = await runAgent({
          locationId: p.locationId,
          contactId: p.contactId,
          conversationId: p.conversationId,
          incomingMessage: p.body,
          messageHistory: history,
        })

        console.log(
          `[Agent] Replied to ${p.contactId}: "${result.reply?.slice(0, 60)}…" | ` +
          `Actions: ${result.actionsPerformed.join(', ')} | Tokens: ${result.tokensUsed}`
        )
        break
      }

      // ── Contact events ─────────────────────────────────────────────────
      case 'ContactCreate':
        console.log(`[Webhook] New contact: ${payload.id} at ${payload.locationId}`)
        break

      case 'ContactTagUpdate':
        console.log(`[Webhook] Tags updated for contact: ${payload.contactId}`)
        break

      // ── Opportunity events ─────────────────────────────────────────────
      case 'OpportunityStageUpdate':
        console.log(`[Webhook] Opportunity stage updated: ${payload.id} → ${payload.stage?.name}`)
        break

      case 'OpportunityStatusUpdate':
        console.log(`[Webhook] Opportunity status: ${payload.id} → ${payload.status}`)
        break

      default:
        console.log(`[Webhook] Unhandled event type: ${eventType}`)
    }
  } catch (err) {
    console.error(`[Webhook] Error handling ${eventType}:`, err)
    // Always return 200 to prevent webhook retries for non-retriable errors
  }

  // Always acknowledge receipt
  return NextResponse.json({ received: true }, { status: 200 })
}
