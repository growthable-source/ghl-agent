import { createHmac } from 'crypto'
import { db } from './db'

/**
 * Fire a webhook event to all active subscriptions in a workspace that
 * have subscribed to this event type. HMAC-signs the payload with each
 * subscription's secret.
 *
 * Event names (stable contract):
 *   - message.sent
 *   - message.error
 *   - agent.paused
 *   - agent.resumed
 *   - appointment.booked
 *   - follow_up.scheduled
 *   - follow_up.sent
 *   - follow_up.cancelled
 *   - goal.achieved
 */
export async function fireWebhook(params: {
  workspaceId: string
  event: string
  payload: Record<string, unknown>
}) {
  let subs: Array<{ id: string; url: string; secret: string; events: string[] }>
  try {
    subs = await db.webhookSubscription.findMany({
      where: { workspaceId: params.workspaceId, isActive: true },
      select: { id: true, url: true, secret: true, events: true },
    })
  } catch {
    return
  }

  const matching = subs.filter(
    s => s.events.length === 0 || s.events.includes(params.event)
  )

  // Fire in parallel, don't await — webhooks never block the caller
  for (const sub of matching) {
    deliverWebhook(sub, params.event, params.payload).catch(err =>
      console.warn('[Webhook] delivery error', sub.id, err.message)
    )
  }
}

async function deliverWebhook(
  sub: { id: string; url: string; secret: string },
  event: string,
  payload: Record<string, unknown>,
) {
  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  })
  const signature = createHmac('sha256', sub.secret).update(body).digest('hex')

  let statusCode: number | null = null
  let responseBody: string | null = null
  let succeeded = false

  try {
    const res = await fetch(sub.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Voxility-Event': event,
        'X-Voxility-Signature': `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(10000),
    })
    statusCode = res.status
    responseBody = (await res.text()).slice(0, 500)
    succeeded = res.ok
  } catch (err: any) {
    responseBody = err.message?.slice(0, 500) || 'Network error'
  }

  try {
    await db.webhookDelivery.create({
      data: {
        subscriptionId: sub.id,
        event,
        payload: payload as any,
        statusCode,
        responseBody,
        succeeded,
      },
    })
  } catch {
    // Delivery log table may not exist yet
  }
}

export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return 'whsec_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}
