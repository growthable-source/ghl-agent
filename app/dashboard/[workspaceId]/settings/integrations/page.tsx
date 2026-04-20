'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'

const EVENT_OPTIONS = [
  { value: 'human_handover',      label: 'Human handover (agent escalated)' },
  { value: 'needs_attention',     label: 'Needs attention' },
  { value: 'approval_pending',    label: 'Approval pending' },
  { value: 'agent_error',         label: 'Agent error' },
  { value: 'pause_activated',     label: 'Pause activated' },
  { value: 'message.sent',        label: 'Message sent' },
  { value: 'appointment.booked',  label: 'Appointment booked' },
  { value: 'follow_up.scheduled', label: 'Follow-up scheduled' },
  { value: 'follow_up.sent',      label: 'Follow-up sent' },
  { value: 'goal.achieved',       label: 'Goal achieved' },
]

export default function IntegrationsPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const [channels, setChannels] = useState<any[]>([])
  const [webhooks, setWebhooks] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'notifications' | 'webhooks'>('notifications')

  // Banners from OAuth round-trips (?connected=slack, ?error=slack:access_denied, etc.)
  const connected = searchParams.get('connected')
  const flashError = searchParams.get('error')

  const [newEmail, setNewEmail] = useState('')
  const [newSmsNumber, setNewSmsNumber] = useState('')
  const [newWebhookUrl, setNewWebhookUrl] = useState('')
  const [newWebhookEvents, setNewWebhookEvents] = useState<string[]>([])

  const fetchAll = useCallback(async () => {
    const [n, w] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/notifications`).then(r => r.json()),
      fetch(`/api/workspaces/${workspaceId}/webhooks`).then(r => r.json()),
    ])
    setChannels(n.channels || [])
    setWebhooks(w.subscriptions || [])
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Slack + Discord are now OAuth — the dashboard kicks off the flow, the
  // callback handler (app/api/auth/slack/callback, /discord/callback)
  // creates the NotificationChannel and redirects back with ?connected=…
  function connectSlack() {
    window.location.href = `/api/auth/slack/connect?workspaceId=${workspaceId}`
  }
  function connectDiscord() {
    window.location.href = `/api/auth/discord/connect?workspaceId=${workspaceId}`
  }

  async function addEmail() {
    if (!newEmail) return
    await fetch(`/api/workspaces/${workspaceId}/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'email', config: { email: newEmail }, events: [] }),
    })
    setNewEmail('')
    fetchAll()
  }

  async function addSms() {
    if (!newSmsNumber) return
    // Basic E.164-ish validation — lets Twilio reject anything weird.
    const cleaned = newSmsNumber.trim()
    if (!/^\+?[1-9]\d{6,14}$/.test(cleaned.replace(/\s|-|\(|\)/g, ''))) {
      alert('Phone number looks invalid. Use E.164 format like +14155551234.')
      return
    }
    await fetch(`/api/workspaces/${workspaceId}/notifications`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'sms', config: { phoneNumber: cleaned }, events: [] }),
    })
    setNewSmsNumber('')
    fetchAll()
  }

  async function testChannel(id: string) {
    await fetch(`/api/workspaces/${workspaceId}/notifications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test' }),
    })
    alert('Test sent')
  }

  async function deleteChannel(id: string) {
    if (!confirm('Remove this notification channel?')) return
    await fetch(`/api/workspaces/${workspaceId}/notifications/${id}`, { method: 'DELETE' })
    fetchAll()
  }

  async function addWebhook() {
    if (!newWebhookUrl) return
    await fetch(`/api/workspaces/${workspaceId}/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: newWebhookUrl, events: newWebhookEvents }),
    })
    setNewWebhookUrl(''); setNewWebhookEvents([])
    fetchAll()
  }

  async function testWebhook(id: string) {
    await fetch(`/api/workspaces/${workspaceId}/webhooks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test' }),
    })
    alert('Test event fired — check deliveries in a moment')
  }

  async function deleteWebhook(id: string) {
    if (!confirm('Remove this webhook?')) return
    await fetch(`/api/workspaces/${workspaceId}/webhooks/${id}`, { method: 'DELETE' })
    fetchAll()
  }

  if (loading) return <div className="p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Notifications &amp; Webhooks</h1>
          <p className="text-sm text-zinc-400 mt-1">Get alerted in Slack/email and fire events into your own systems.</p>
        </div>

        {connected && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            <span>
              ✓ Connected <span className="font-semibold capitalize">{connected}</span>. You can pick which events it receives below.
            </span>
            <button
              onClick={() => router.replace(`/dashboard/${workspaceId}/settings/integrations`)}
              className="text-emerald-200 hover:text-white text-xs"
            >Dismiss</button>
          </div>
        )}
        {flashError && (
          <div className="mb-6 flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <span>Couldn&apos;t connect: <span className="font-mono">{flashError}</span></span>
            <button
              onClick={() => router.replace(`/dashboard/${workspaceId}/settings/integrations`)}
              className="text-red-200 hover:text-white text-xs"
            >Dismiss</button>
          </div>
        )}

        <div className="flex gap-1 p-1 rounded-xl bg-zinc-900/60 border border-zinc-800 mb-6 w-fit">
          <button onClick={() => setTab('notifications')}
            className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors ${tab === 'notifications' ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
            style={tab === 'notifications' ? { background: 'rgba(250,77,46,0.12)', color: '#fa4d2e' } : undefined}
          >
            Notifications ({channels.length})
          </button>
          <button onClick={() => setTab('webhooks')}
            className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors ${tab === 'webhooks' ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
            style={tab === 'webhooks' ? { background: 'rgba(250,77,46,0.12)', color: '#fa4d2e' } : undefined}
          >
            Webhooks ({webhooks.length})
          </button>
        </div>

        {tab === 'notifications' && (
          <div>
            {/* Existing channels */}
            {channels.length > 0 && (
              <div className="space-y-2 mb-6">
                {channels.map(c => (
                  <div key={c.id} className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40 flex items-center gap-3">
                    <span className="text-lg">{
                      c.type === 'slack' ? '💬'
                      : c.type === 'discord' ? '🎮'
                      : c.type === 'sms' ? '📱'
                      : '📧'
                    }</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white capitalize">
                        {c.type === 'slack' && c.config.teamName
                          ? `Slack · ${c.config.teamName}`
                          : c.type === 'discord' && c.config.guildName
                          ? `Discord · ${c.config.guildName}`
                          : c.type}
                      </p>
                      <p className="text-xs text-zinc-500 truncate">
                        {c.type === 'slack'
                          ? (c.config.channel ? `#${c.config.channel}` : c.config.webhookUrl?.replace(/(hooks.slack.com\/services\/).*/, '$1...'))
                          : c.type === 'discord'
                          ? (c.config.webhookName ? `via “${c.config.webhookName}”` : c.config.webhookUrl?.replace(/(discord.com\/api\/webhooks\/).*/, '$1...'))
                          : c.type === 'sms'
                          ? c.config.phoneNumber
                          : c.config.email}
                      </p>
                      {c.events.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {c.events.slice(0, 3).map((e: string) => (
                            <span key={e} className="text-[10px] text-zinc-500 px-1.5 py-0.5 bg-zinc-800 rounded">{e}</span>
                          ))}
                          {c.events.length > 3 && <span className="text-[10px] text-zinc-500">+{c.events.length - 3}</span>}
                        </div>
                      )}
                    </div>
                    <button onClick={() => testChannel(c.id)} className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors">
                      Test
                    </button>
                    <button onClick={() => deleteChannel(c.id)} className="text-zinc-500 hover:text-red-400 p-1">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40 mb-3 flex items-start gap-4">
              <span className="text-2xl">💬</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white">Slack</p>
                <p className="text-xs text-zinc-500 mt-1">
                  Connect a channel via OAuth. You&apos;ll pick which channel Voxility posts to during install — nothing to paste.
                </p>
              </div>
              <button onClick={connectSlack}
                className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-colors shrink-0"
                style={{ background: '#4A154B' }}>
                Add to Slack
              </button>
            </div>

            <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40 mb-3">
              <p className="text-sm font-semibold text-white mb-3">📧 Add Email</p>
              <p className="text-xs text-zinc-500 mb-3">Receive notifications via email. Powered by Resend — requires <code className="text-orange-400">RESEND_API_KEY</code> in server env.</p>
              <div className="flex gap-2">
                <input value={newEmail} onChange={e => setNewEmail(e.target.value)}
                  placeholder="you@company.com" type="email"
                  className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white" />
                <button onClick={addEmail} disabled={!newEmail}
                  className="text-xs font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-50 hover:opacity-90 transition-colors"
                  style={{ background: '#fa4d2e' }}>
                  Add
                </button>
              </div>
            </div>

            <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40 mb-3 flex items-start gap-4">
              <span className="text-2xl">🎮</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white">Discord</p>
                <p className="text-xs text-zinc-500 mt-1">
                  Connect a server and channel via OAuth. Discord walks you through the server and channel picker — no webhook URL to copy.
                </p>
              </div>
              <button onClick={connectDiscord}
                className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-colors shrink-0"
                style={{ background: '#5865F2' }}>
                Add to Discord
              </button>
            </div>

            <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40">
              <p className="text-sm font-semibold text-white mb-3">📱 Add SMS</p>
              <p className="text-xs text-zinc-500 mb-3">
                Get paged via SMS when an agent hands over. Sends through your workspace&apos;s existing Twilio connection
                (or <code className="text-orange-400">TWILIO_ACCOUNT_SID</code> / <code className="text-orange-400">TWILIO_AUTH_TOKEN</code> env vars).
                Use E.164 format.
              </p>
              <div className="flex gap-2">
                <input value={newSmsNumber} onChange={e => setNewSmsNumber(e.target.value)}
                  placeholder="+14155551234" type="tel"
                  className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white font-mono" />
                <button onClick={addSms} disabled={!newSmsNumber}
                  className="text-xs font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-50 hover:opacity-90 transition-colors"
                  style={{ background: '#fa4d2e' }}>
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'webhooks' && (
          <div>
            {webhooks.length > 0 && (
              <div className="space-y-2 mb-6">
                {webhooks.map(w => (
                  <div key={w.id} className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-2 h-2 rounded-full"
                        style={{ background: w.isActive ? '#22c55e' : '#3f3f46' }} />
                      <p className="text-sm font-mono text-white truncate flex-1">{w.url}</p>
                      <button onClick={() => testWebhook(w.id)} className="text-xs px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors">
                        Test fire
                      </button>
                      <button onClick={() => deleteWebhook(w.id)} className="text-zinc-500 hover:text-red-400 p-1">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {w.events.map((e: string) => (
                        <span key={e} className="text-[10px] font-medium text-purple-400 px-2 py-0.5 rounded-full bg-purple-500/10">{e}</span>
                      ))}
                    </div>
                    {w.deliveries?.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-zinc-800">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Recent deliveries</p>
                        <div className="flex gap-1 flex-wrap">
                          {w.deliveries.map((d: any) => (
                            <span key={d.id} className={`text-[10px] px-1.5 py-0.5 rounded ${
                              d.succeeded ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                            }`}>
                              {d.event} {d.statusCode || 'err'}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40">
              <p className="text-sm font-semibold text-white mb-2">🔌 New webhook endpoint</p>
              <p className="text-xs text-zinc-500 mb-3">
                Payloads are HMAC-SHA256 signed — check the <code className="text-orange-400">X-Voxility-Signature</code> header.
              </p>
              <input value={newWebhookUrl} onChange={e => setNewWebhookUrl(e.target.value)}
                placeholder="https://your-app.com/webhooks/voxility"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white font-mono mb-3"
              />
              <p className="text-xs text-zinc-400 mb-2">Events to subscribe to:</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
                {EVENT_OPTIONS.map(e => (
                  <label key={e.value} className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={newWebhookEvents.includes(e.value)}
                      onChange={ev => {
                        if (ev.target.checked) setNewWebhookEvents([...newWebhookEvents, e.value])
                        else setNewWebhookEvents(newWebhookEvents.filter(x => x !== e.value))
                      }}
                      className="w-3 h-3 accent-orange-500"
                    />
                    {e.label}
                  </label>
                ))}
              </div>
              <button onClick={addWebhook} disabled={!newWebhookUrl || newWebhookEvents.length === 0}
                className="text-xs font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-50 hover:opacity-90 transition-colors"
                style={{ background: '#fa4d2e' }}>
                Add webhook
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
