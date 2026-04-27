/**
 * Browser push delivery via Web Push (VAPID).
 *
 * Required env:
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY  — base64url, exposed to the browser so
 *                                   the service worker can subscribe
 *   VAPID_PRIVATE_KEY             — base64url, server-only signing key
 *   VAPID_SUBJECT                 — mailto:you@yourdomain.com (optional;
 *                                   defaults to mailto:notifications@voxility.app)
 *
 * Generate the keypair once with:
 *   npx web-push generate-vapid-keys
 * (or use the values produced when this feature was bootstrapped).
 */

import webpush from 'web-push'
import { db } from './db'

let vapidConfigured = false
function configureVapid() {
  if (vapidConfigured) return true
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''
  const privateKey = process.env.VAPID_PRIVATE_KEY || ''
  const subject = process.env.VAPID_SUBJECT || 'mailto:notifications@voxility.app'
  if (!publicKey || !privateKey) return false
  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidConfigured = true
  return true
}

export interface PushPayload {
  title: string
  body?: string
  link?: string
  tag?: string                  // group similar notifications by tag
  severity?: 'info' | 'warning' | 'error'
}

/**
 * Send a push notification to one user (across all their devices).
 * Stale subscriptions (410 Gone, 404 Not Found) are pruned automatically.
 */
export async function sendPushToUser(
  userId: string,
  workspaceId: string,
  payload: PushPayload,
): Promise<{ delivered: number; pruned: number }> {
  if (!configureVapid()) {
    console.warn('[WebPush] VAPID keys not configured — skipping push for', userId)
    return { delivered: 0, pruned: 0 }
  }

  let subs: Array<{ id: string; endpoint: string; p256dh: string; auth: string }> = []
  try {
    subs = await (db as any).webPushSubscription.findMany({
      where: { userId, workspaceId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    })
  } catch (err: any) {
    if (
      err?.code === 'P2021'
      || err?.code === 'P2022'
      || /relation .* does not exist/i.test(err?.message ?? '')
    ) return { delivered: 0, pruned: 0 }
    throw err
  }
  if (subs.length === 0) return { delivered: 0, pruned: 0 }

  const body = JSON.stringify(payload)
  let delivered = 0
  let pruned = 0

  await Promise.all(subs.map(async sub => {
    try {
      await webpush.sendNotification({
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      }, body, { TTL: 60 * 60 })   // 1h delivery window
      delivered++
      // Bump lastUsedAt — best effort
      await (db as any).webPushSubscription.update({
        where: { id: sub.id },
        data: { lastUsedAt: new Date() },
      }).catch(() => {})
    } catch (err: any) {
      const status = err?.statusCode
      if (status === 404 || status === 410) {
        // Subscription is dead — clean it up
        await (db as any).webPushSubscription.delete({ where: { id: sub.id } }).catch(() => {})
        pruned++
      } else {
        console.warn('[WebPush] send failed:', status, err?.message?.slice(0, 120))
      }
    }
  }))

  return { delivered, pruned }
}
