'use client'

/**
 * Workspace live-chat queue settings. Cap how many human chats run at
 * once; when the team is full, new human requests wait in a queue with
 * a visible position + estimate, and can optionally play a game or
 * leave an email (which opens a support ticket) while they wait.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import NewBadge from '@/components/NewBadge'

interface Settings {
  queueEnabled: boolean
  maxConcurrentHumanChats: number
  queueGameEnabled: boolean
  queueEmailTicketEnabled: boolean
  queueMessage: string | null
}

export default function LiveChatSettingsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/workspaces/${workspaceId}/live-chat-settings`)
    const data = await res.json()
    setSettings(data.settings)
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { load() }, [load])

  async function patch(updates: Partial<Settings>) {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/live-chat-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to save.'); return }
      setSettings(data.settings)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } finally {
      setSaving(false)
    }
  }

  if (loading || !settings) {
    return <div className="p-8 max-w-2xl"><div className="h-40 rounded-xl animate-pulse" style={{ background: 'var(--surface)' }} /></div>
  }

  const s = settings
  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
        Live chat queue <NewBadge since="2026-06-15" className="ml-1" />
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        Visitors wait in a queue whenever the team is at capacity <em>or</em> no one is online — they keep a visible
        position and estimate, can keep chatting with the AI, and (below) play a game or leave an email while they wait.
      </p>

      <div className="rounded-xl border p-5 space-y-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <Toggle
          label="Enable the capacity queue"
          help="When on, handoffs wait once you hit the cap below. When off, an online agent is assigned immediately. Either way, if nobody is online the visitor still sees the wait experience."
          checked={s.queueEnabled}
          disabled={saving}
          onChange={v => patch({ queueEnabled: v })}
        />

        <div className={s.queueEnabled ? '' : 'opacity-40 pointer-events-none'}>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>
            Max concurrent human chats
          </label>
          <input
            type="number"
            min={1}
            max={1000}
            value={s.maxConcurrentHumanChats}
            disabled={saving || !s.queueEnabled}
            onChange={e => setSettings({ ...s, maxConcurrentHumanChats: Number(e.target.value) })}
            onBlur={e => patch({ maxConcurrentHumanChats: Number(e.target.value) })}
            className="w-28 rounded-lg px-3 py-2 text-sm"
            style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            Across the whole team, at once. AI-only chats don&rsquo;t count.
          </p>
        </div>

        <div className="pt-2 border-t space-y-5" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>While they wait</p>
          <p className="text-xs -mt-3" style={{ color: 'var(--text-tertiary)' }}>
            These apply whenever a visitor is waiting — at capacity or with nobody online — independent of the capacity queue above.
          </p>
          <Toggle
            label="Offer a mini-game"
            help="Show waiting visitors an optional game in the widget. Runs entirely offline."
            checked={s.queueGameEnabled}
            disabled={saving}
            onChange={v => patch({ queueGameEnabled: v })}
          />
          <Toggle
            label="Offer “leave your email”"
            help="A waiting visitor can leave their email — it opens a support ticket. Requires ticketing to be active."
            checked={s.queueEmailTicketEnabled}
            disabled={saving}
            onChange={v => patch({ queueEmailTicketEnabled: v })}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>
            Queue message <span className="font-normal" style={{ color: 'var(--text-tertiary)' }}>(optional)</span>
          </label>
          <input
            value={s.queueMessage ?? ''}
            disabled={saving}
            placeholder="Thanks for your patience — an agent will be with you shortly."
            onChange={e => setSettings({ ...s, queueMessage: e.target.value })}
            onBlur={e => patch({ queueMessage: e.target.value || null })}
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
          />
        </div>

        {error && <p className="text-sm" style={{ color: 'var(--accent-red)' }}>{error}</p>}
        {saved && <p className="text-sm" style={{ color: 'var(--accent-emerald)' }}>✓ Saved</p>}
      </div>
    </div>
  )
}

function Toggle({ label, help, checked, disabled, onChange }: {
  label: string; help: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{help}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="shrink-0 w-10 h-6 rounded-full transition-colors disabled:opacity-40"
        style={{ background: checked ? 'var(--accent-primary)' : 'var(--surface-tertiary)' }}
      >
        <span
          className="block w-5 h-5 rounded-full bg-white transition-transform"
          style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }}
        />
      </button>
    </div>
  )
}
