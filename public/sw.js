/**
 * Voxility service worker — handles browser push notifications.
 *
 * Registered by /dashboard/[ws]/settings/notifications when the user
 * clicks "Enable browser push". The page POSTs the resulting subscription
 * to /api/workspaces/[ws]/notifications/push/subscribe so we can dispatch
 * to it later via lib/web-push.ts.
 */

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (_) {}

  const title = data.title || 'Voxility'
  const body = data.body || ''
  const tag = data.tag || 'voxility-notification'
  const link = data.link || '/'
  const severity = data.severity || 'info'

  const icon = severity === 'error' ? '/icon-error.png' : '/icon-192.png'

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon,
      badge: '/badge-72.png',
      data: { link },
      requireInteraction: severity === 'error' || severity === 'warning',
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const link = (event.notification.data && event.notification.data.link) || '/'
  const url = new URL(link, self.location.origin).toString()

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an existing tab on this origin if one is open
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})
