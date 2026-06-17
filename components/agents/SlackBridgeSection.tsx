'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import NewBadge from '@/components/NewBadge'

type Mode = 'off' | 'ai_with_handoff' | 'slack_only'

interface SlackChannel {
  id: string
  name: string
}

const MODE_OPTIONS: Array<{ value: Mode; label: string; help: string }> = [
  { value: 'off', label: 'Off', help: 'Normal AI behaviour. Nothing is sent to Slack.' },
  {
    value: 'ai_with_handoff',
    label: 'AI with Slack handoff',
    help: 'The AI answers, and every conversation is mirrored into a Slack thread. A teammate can take over any time by replying in the thread — that pauses the AI for that chat.',
  },
  {
    value: 'slack_only',
    label: 'Slack only (human answers)',
    help: 'Every chat is sent to Slack from the first message and the AI never replies. Your team answers from the Slack thread; the visitor just sees a normal chat.',
  },
]

/**
 * Per-agent Slack bridging control. Reads/writes Agent.slackBridgeMode and
 * the optional per-agent channel override. Self-contained (its own inline
 * save) so it never collides with the page's sticky SaveBar.
 */
export default function SlackBridgeSection({
  workspaceId,
  agentId,
}: {
  workspaceId: string
  agentId: string
}) {
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [defaultChannelName, setDefaultChannelName] = useState<string | null>(null)
  const [channels, setChannels] = useState<SlackChannel[]>([])

  const [mode, setMode] = useState<Mode>('off')
  const [channelId, setChannelId] = useState('')
  const [savedMode, setSavedMode] = useState<Mode>('off')
  const [savedChannelId, setSavedChannelId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`).then(r => r.json()),
      fetch(`/api/workspaces/${workspaceId}/integrations/slack`).then(r => r.json()).catch(() => ({ connected: false })),
    ])
      .then(([agentRes, slackRes]) => {
        const m = (agentRes?.agent?.slackBridgeMode ?? 'off') as Mode
        const ch = (agentRes?.agent?.slackChannelId ?? '') as string
        setMode(m)
        setSavedMode(m)
        setChannelId(ch)
        setSavedChannelId(ch)
        setConnected(!!slackRes?.connected)
        setDefaultChannelName(slackRes?.defaultChannelName ?? null)
      })
      .finally(() => setLoading(false))
  }, [workspaceId, agentId])

  // Lazily load channels only when bridging is on (avoids a Slack API call
  // on every trigger-page visit).
  useEffect(() => {
    if (!connected || mode === 'off' || channels.length > 0) return
    fetch(`/api/workspaces/${workspaceId}/integrations/slack/channels`)
      .then(r => r.json())
      .then(d => setChannels(d.channels ?? []))
      .catch(() => setChannels([]))
  }, [connected, mode, channels.length, workspaceId])

  const dirty = mode !== savedMode || channelId !== savedChannelId

  async function save() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slackBridgeMode: mode, slackChannelId: channelId || null }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
      setSavedMode(mode)
      setSavedChannelId(channelId)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <div className="rounded-xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-zinc-100">Slack bridging</h3>
        <NewBadge since="2026-06-17" />
      </div>
      <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
        Send this agent&apos;s live-chat conversations into Slack and let your team reply from a thread. The
        visitor&apos;s widget experience is unchanged.
      </p>

      {!connected ? (
        <div
          className="mt-4 rounded-lg border px-4 py-3 text-xs"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          Slack isn&apos;t connected for this workspace yet.{' '}
          <Link href={`/dashboard/${workspaceId}/integrations/slack`} className="underline text-zinc-200">
            Connect Slack
          </Link>{' '}
          first.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            {MODE_OPTIONS.map(opt => (
              <label
                key={opt.value}
                className="flex gap-3 rounded-lg border p-3 cursor-pointer"
                style={{
                  borderColor: mode === opt.value ? '#fa4d2e' : 'var(--border)',
                  background: mode === opt.value ? 'rgba(250,77,46,0.06)' : 'transparent',
                }}
              >
                <input
                  type="radio"
                  name="slackBridgeMode"
                  className="mt-0.5"
                  checked={mode === opt.value}
                  onChange={() => setMode(opt.value)}
                />
                <span>
                  <span className="block text-sm font-medium text-zinc-100">{opt.label}</span>
                  <span className="block text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    {opt.help}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {mode !== 'off' && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                Channel override (optional)
              </label>
              <select
                value={channelId}
                onChange={e => setChannelId(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm bg-zinc-900 text-zinc-100"
                style={{ borderColor: 'var(--border)' }}
              >
                <option value="">
                  Use workspace default{defaultChannelName ? ` (#${defaultChannelName})` : ''}
                </option>
                {channels.map(c => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && (
            <p className="text-xs" style={{ color: 'var(--accent-red)' }}>
              {error}
            </p>
          )}

          <button
            onClick={save}
            disabled={!dirty || saving}
            className="text-xs font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-40 transition-opacity"
            style={{ background: '#fa4d2e' }}
          >
            {saving ? 'Saving…' : 'Save Slack settings'}
          </button>
        </div>
      )}
    </div>
  )
}
