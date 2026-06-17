'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'

interface SlackStatus {
  connected: boolean
  teamName: string | null
  defaultChannelId: string | null
  defaultChannelName: string | null
}
interface SlackChannel {
  id: string
  name: string
  isMember: boolean
}

export default function SlackIntegrationPage() {
  const params = useParams()
  const search = useSearchParams()
  const workspaceId = params.workspaceId as string

  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<SlackStatus | null>(null)
  const [channels, setChannels] = useState<SlackChannel[]>([])
  const [selectedChannel, setSelectedChannel] = useState('')
  const [saving, setSaving] = useState(false)
  const [banner, setBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  async function loadStatus() {
    const res = await fetch(`/api/workspaces/${workspaceId}/integrations/slack`)
    const data: SlackStatus = await res.json()
    setStatus(data)
    setSelectedChannel(data.defaultChannelId ?? '')
    if (data.connected) {
      const ch = await fetch(`/api/workspaces/${workspaceId}/integrations/slack/channels`)
        .then(r => r.json())
        .catch(() => ({ channels: [] }))
      setChannels(ch.channels ?? [])
    }
  }

  useEffect(() => {
    loadStatus().finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  // Surface the OAuth callback result once, then strip the query.
  useEffect(() => {
    if (search.get('connected')) setBanner({ kind: 'success', text: 'Slack connected. Pick a channel below.' })
    const err = search.get('error')
    if (err) setBanner({ kind: 'error', text: `Slack connection failed: ${err}` })
    if (search.get('connected') || err) {
      const url = new URL(window.location.href)
      url.searchParams.delete('connected')
      url.searchParams.delete('error')
      window.history.replaceState({}, '', url.toString())
    }
  }, [search])

  async function saveChannel() {
    const channel = channels.find(c => c.id === selectedChannel)
    if (!channel) return
    setSaving(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/integrations/slack`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultChannelId: channel.id, defaultChannelName: channel.name }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
      setBanner({ kind: 'success', text: `Default channel set to #${channel.name}.` })
      await loadStatus()
    } catch (e: unknown) {
      setBanner({ kind: 'error', text: e instanceof Error ? e.message : 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  async function disconnect() {
    if (!confirm('Disconnect Slack? Bridged conversations will stop posting to Slack.')) return
    setSaving(true)
    try {
      await fetch(`/api/workspaces/${workspaceId}/integrations/slack`, { method: 'DELETE' })
      setBanner({ kind: 'success', text: 'Slack disconnected.' })
      await loadStatus()
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-sm" style={{ color: 'var(--text-secondary)' }}>Loading…</div>
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/dashboard/${workspaceId}/integrations`} className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Integrations
        </Link>
      </div>

      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Slack</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Bridge live-chat conversations into a Slack channel. Each chat becomes a thread; your team replies
          in the thread and the reply lands in the visitor&apos;s widget. Start a reply with <code>!</code> to
          post an internal note your team sees but the visitor doesn&apos;t.
        </p>
      </div>

      {banner && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={
            banner.kind === 'success'
              ? { borderColor: 'var(--accent-emerald)', background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }
              : { borderColor: 'var(--accent-red)', background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }
          }
        >
          {banner.text}
        </div>
      )}

      <div className="rounded-xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        {!status?.connected ? (
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-200">Not connected</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                Authorize the Voxility Slack app to post into your workspace.
              </p>
            </div>
            <a
              href={`/api/integrations/slack/install?workspaceId=${workspaceId}`}
              className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-opacity shrink-0"
              style={{ background: '#4A154B' }}
            >
              Add to Slack
            </a>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-zinc-200">
                  Connected{status.teamName ? ` to ${status.teamName}` : ''}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  Invite the bot to your target channel in Slack with <code>/invite @Voxility</code>.
                </p>
              </div>
              <span className="text-[11px] font-semibold px-2 py-1 rounded bg-emerald-900/30 text-emerald-400 shrink-0">
                Active
              </span>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                Default channel
              </label>
              <div className="flex items-center gap-2">
                <select
                  value={selectedChannel}
                  onChange={e => setSelectedChannel(e.target.value)}
                  className="flex-1 rounded-lg border px-3 py-2 text-sm bg-zinc-900 text-zinc-100"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <option value="">Select a channel…</option>
                  {channels.map(c => (
                    <option key={c.id} value={c.id}>
                      #{c.name}
                      {c.isMember ? '' : ' (invite the bot first)'}
                    </option>
                  ))}
                </select>
                <button
                  onClick={saveChannel}
                  disabled={saving || !selectedChannel || selectedChannel === status.defaultChannelId}
                  className="text-xs font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-40 transition-opacity"
                  style={{ background: '#fa4d2e' }}
                >
                  Save
                </button>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Agents can override this per-agent on their Deploy tab. Set an agent&apos;s Slack mode there to
                start bridging.
              </p>
            </div>

            <button
              onClick={disconnect}
              disabled={saving}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border disabled:opacity-40"
              style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
