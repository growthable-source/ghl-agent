'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface EventPref {
  id: string
  label: string
  description: string
  channels: string[]
  isDefault: boolean
}

type PushState = 'unsupported' | 'denied' | 'inactive' | 'active' | 'busy' | 'unknown'

export default function NotificationsSettingsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [events, setEvents] = useState<EventPref[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pushState, setPushState] = useState<PushState>('unknown')
  const [pushEndpoint, setPushEndpoint] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/notifications/preferences`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not load preferences')
        return
      }
      setEvents(data.events || [])
      if (data.notMigrated) setError('Per-user notifications need a database migration — run prisma/migrations-legacy/manual_per_user_notifications.sql in Supabase.')
    } catch (err: any) {
      setError(err.message || 'Network error')
    }
  }, [workspaceId])

  useEffect(() => { refresh() }, [refresh])

  // Detect existing push subscription on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushState('unsupported')
      return
    }
    if (Notification.permission === 'denied') {
      setPushState('denied')
      return
    }
    navigator.serviceWorker.getRegistration('/sw.js').then(async reg => {
      if (!reg) { setPushState('inactive'); return }
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        setPushState('active')
        setPushEndpoint(sub.endpoint)
      } else {
        setPushState('inactive')
      }
    }).catch(() => setPushState('inactive'))
  }, [])

  async function setChannels(eventId: string, channels: string[]) {
    if (!events) return
    setEvents(events.map(e => e.id === eventId ? { ...e, channels, isDefault: false } : e))
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/notifications/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: eventId, channels }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Could not save preference')
      }
    } catch (err: any) {
      setError(err.message || 'Network error')
    }
  }

  function toggleChannel(eventId: string, channel: 'email' | 'web_push') {
    if (!events) return
    const ev = events.find(e => e.id === eventId)
    if (!ev) return
    const next = ev.channels.includes(channel)
      ? ev.channels.filter(c => c !== channel)
      : [...ev.channels, channel]
    setChannels(eventId, next)
  }

  async function enablePush() {
    setPushState('busy')
    setStatusMsg(null)
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setPushState('unsupported'); return
      }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') { setPushState('denied'); return }

      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!publicKey) {
        setStatusMsg('NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set in Vercel — push cannot be enabled.')
        setPushState('inactive')
        return
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast to BufferSource — TS over-narrows the Uint8Array buffer type
        // here, but the runtime value is exactly what PushManager wants.
        applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
      })

      const json = sub.toJSON() as { keys?: { p256dh?: string; auth?: string } }
      const res = await fetch(`/api/workspaces/${workspaceId}/notifications/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
          userAgent: navigator.userAgent,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStatusMsg(data.error || 'Could not register subscription')
        setPushState('inactive')
        return
      }
      setPushState('active')
      setPushEndpoint(sub.endpoint)
      setStatusMsg('Browser push enabled.')
    } catch (err: any) {
      setStatusMsg(err.message || 'Could not enable push')
      setPushState('inactive')
    }
  }

  async function disablePush() {
    setPushState('busy')
    setStatusMsg(null)
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      const sub = reg ? await reg.pushManager.getSubscription() : null
      const endpoint = sub?.endpoint || pushEndpoint
      if (sub) await sub.unsubscribe()
      if (endpoint) {
        await fetch(`/api/workspaces/${workspaceId}/notifications/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`, {
          method: 'DELETE',
        }).catch(() => {})
      }
      setPushState('inactive')
      setPushEndpoint(null)
      setStatusMsg('Browser push disabled on this device.')
    } catch (err: any) {
      setStatusMsg(err.message || 'Could not disable push')
      setPushState('active')
    }
  }

  async function sendTestPush() {
    setStatusMsg(null)
    const res = await fetch(`/api/workspaces/${workspaceId}/notifications/push/test`, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) setStatusMsg(data.error || 'Could not send test')
    else setStatusMsg(`Test sent to ${data.delivered} device${data.delivered === 1 ? '' : 's'}.`)
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Notifications</h1>
        <p className="text-sm text-zinc-400 mt-1 max-w-2xl">
          Pick where you want to be pinged for each event. These preferences are personal to you — your teammates each set their own. Workspace-shared channels (Slack, Discord, team email) are managed under Settings → Integrations.
        </p>
      </div>

      {error && (
        <div className="mb-6 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-xs text-amber-300">
          {error}
        </div>
      )}

      {/* Browser push card */}
      <div className="mb-8 p-5 rounded-xl border border-zinc-800 bg-zinc-900/40">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-white">🔔 Browser push notifications</p>
            <p className="text-xs text-zinc-500 mt-1 max-w-md">
              {pushState === 'unsupported' && 'This browser doesn\'t support push notifications.'}
              {pushState === 'denied' && 'You\'ve blocked notifications in your browser. Re-enable from your browser\'s site settings.'}
              {pushState === 'inactive' && 'Get a desktop notification the moment something needs you. Works in Chrome, Firefox, Edge, and Safari (macOS 13+).'}
              {pushState === 'active' && 'Active on this device. Toggle individual events below to control which fire.'}
              {pushState === 'busy' && 'Working…'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {pushState === 'inactive' && (
              <button onClick={enablePush}
                className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-colors"
                style={{ background: '#fa4d2e' }}
              >Enable browser push</button>
            )}
            {pushState === 'active' && (
              <>
                <button onClick={sendTestPush}
                  className="text-xs font-medium px-3 py-2 rounded-lg text-zinc-300 border border-zinc-700 hover:text-white hover:border-zinc-500 transition-colors"
                >Send test</button>
                <button onClick={disablePush}
                  className="text-xs font-medium px-3 py-2 rounded-lg text-zinc-400 hover:text-red-300 transition-colors"
                >Disable on this device</button>
              </>
            )}
          </div>
        </div>
        {statusMsg && <p className="text-[11px] text-zinc-400 mt-3">{statusMsg}</p>}
      </div>

      {/* Per-event preferences */}
      {events === null ? (
        <div className="h-6 w-32 bg-zinc-800 rounded animate-pulse" />
      ) : (
        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          <table className="w-full">
            <thead className="bg-zinc-900/60 text-[10px] uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="text-left px-4 py-2.5 font-semibold">Event</th>
                <th className="text-center px-3 py-2.5 font-semibold w-20">Email</th>
                <th className="text-center px-3 py-2.5 font-semibold w-24">Browser push</th>
              </tr>
            </thead>
            <tbody>
              {events.map(ev => (
                <tr key={ev.id} className="border-t border-zinc-800">
                  <td className="px-4 py-3.5">
                    <p className="text-sm text-white">{ev.label}</p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{ev.description}</p>
                  </td>
                  <td className="text-center px-3">
                    <Toggle
                      checked={ev.channels.includes('email')}
                      onChange={() => toggleChannel(ev.id, 'email')}
                    />
                  </td>
                  <td className="text-center px-3">
                    <Toggle
                      checked={ev.channels.includes('web_push')}
                      onChange={() => toggleChannel(ev.id, 'web_push')}
                      disabled={pushState !== 'active'}
                      title={pushState === 'active' ? '' : 'Enable browser push above first'}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Toggle({ checked, onChange, disabled, title }: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      title={title}
      className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:opacity-30"
      style={{ background: checked && !disabled ? '#22c55e' : '#3f3f46' }}
    >
      <span className="inline-block h-3 w-3 rounded-full bg-white transition-transform"
        style={{ transform: checked ? 'translateX(20px)' : 'translateX(4px)' }} />
    </button>
  )
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - base64.length % 4) % 4)
  const base = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}
