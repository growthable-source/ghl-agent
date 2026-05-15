'use client'

/**
 * Ticketing preferences page. Two-state UI:
 *   - Plan locked (not on Scale)  → upsell card
 *   - Plan ok                     → toggle + auto-close knobs + from-email
 *                                   + signature
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Settings {
  enabled: boolean
  autoCloseAfterDays: number
  autoReopenOnReply: boolean
  fromEmail: string | null
  fromName: string | null
  signature: string | null
}

interface Status {
  planAllows: boolean
  workspaceEnabled: boolean
  active: boolean
  reason: 'active' | 'plan_locked' | 'not_enabled' | 'plan_locked_and_not_enabled'
}

export default function TicketingSettingsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [settings, setSettings] = useState<Settings | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/workspaces/${workspaceId}/settings/ticketing`)
    const data = await res.json()
    setSettings(data.settings)
    setStatus(data.status)
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { load() }, [load])

  async function patch(updates: Partial<Settings>) {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/settings/ticketing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to save.'); return }
      setSettings(data.settings)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      // Refresh status — toggling enabled changes status.active
      load()
    } finally { setSaving(false) }
  }

  if (loading || !settings || !status) {
    return <div className="p-8"><p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p></div>
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-2xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Ticketing</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Email-driven case management. Promote chats to tickets, draft replies with your AI agent, auto-close stale ones.
          </p>
        </div>

        {!status.planAllows && (
          <div className="rounded-xl border p-5 mb-6" style={{ borderColor: 'var(--accent-amber)', background: 'var(--accent-amber-bg)' }}>
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--accent-amber)' }}>Scale plan required</p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Ticketing is part of the Scale plan. You can still configure the settings below, but the toggle won&apos;t take effect until you upgrade.
            </p>
            <Link href={`/dashboard/${workspaceId}/settings/billing`} className="inline-block mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: 'var(--accent-amber)', color: 'var(--btn-primary-text)' }}>
              See plans →
            </Link>
          </div>
        )}

        <div className="space-y-5">
          {/* Master toggle */}
          <Section title="Status" description="Master switch — when off, the Tickets nav entry is hidden and the promote-to-ticket button on conversations disappears.">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.enabled}
                disabled={!status.planAllows || saving}
                onChange={e => patch({ enabled: e.target.checked })}
                className="accent-orange-500 w-4 h-4"
              />
              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {settings.enabled ? 'Ticketing is ON' : 'Ticketing is OFF'}
              </span>
            </label>
          </Section>

          {/* Auto-close */}
          <Section title="Auto-close" description="Tickets where the team replied and the customer hasn't come back within this window get auto-closed.">
            <div className="flex items-center gap-2 text-sm">
              <span style={{ color: 'var(--text-secondary)' }}>Close after</span>
              <input
                type="number"
                min={0}
                max={365}
                value={settings.autoCloseAfterDays}
                onChange={e => setSettings({ ...settings, autoCloseAfterDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })}
                onBlur={e => patch({ autoCloseAfterDays: Number(e.target.value) || 0 })}
                className="w-16 rounded px-2 py-1"
                style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
              />
              <span style={{ color: 'var(--text-secondary)' }}>days of no customer reply (0 = never auto-close)</span>
            </div>
          </Section>

          <Section title="Auto-reopen on reply" description="When a customer replies to a closed or resolved ticket, bump it back to open so it isn't missed.">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoReopenOnReply}
                onChange={e => patch({ autoReopenOnReply: e.target.checked })}
                className="accent-orange-500 w-4 h-4"
              />
              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {settings.autoReopenOnReply ? 'Reopen automatically' : 'Stay closed'}
              </span>
            </label>
          </Section>

          {/* Sender identity */}
          <Section title="Reply from" description="Outbound emails are sent from this address via Resend. Must be a verified sender on your domain.">
            <div className="space-y-2">
              <div>
                <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>From email</label>
                <input
                  type="email"
                  value={settings.fromEmail ?? ''}
                  onChange={e => setSettings({ ...settings, fromEmail: e.target.value })}
                  onBlur={e => patch({ fromEmail: e.target.value })}
                  placeholder="support@yourcompany.com"
                  className="w-full rounded-lg px-3 py-2 text-sm mt-1"
                  style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
                />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>From name</label>
                <input
                  type="text"
                  value={settings.fromName ?? ''}
                  onChange={e => setSettings({ ...settings, fromName: e.target.value })}
                  onBlur={e => patch({ fromName: e.target.value })}
                  placeholder="Acme Support"
                  className="w-full rounded-lg px-3 py-2 text-sm mt-1"
                  style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
                />
              </div>
            </div>
          </Section>

          <Section title="Email signature" description="Appended to every outbound reply. Plain text.">
            <textarea
              value={settings.signature ?? ''}
              onChange={e => setSettings({ ...settings, signature: e.target.value })}
              onBlur={e => patch({ signature: e.target.value })}
              placeholder={'The Acme Support Team\nhttps://acme.com'}
              rows={4}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
            />
          </Section>

          <Section title="Inbound email (Resend)" description="Resend Inbound posts parsed emails to this webhook. Replies are matched to existing tickets via subject prefix [#N] or the email's In-Reply-To header; unmatched inbound creates a new ticket.">
            <p className="text-[11px] mb-2" style={{ color: 'var(--text-tertiary)' }}>Webhook URL to add in Resend → Inbound → Endpoints:</p>
            <code className="block text-xs p-3 rounded font-mono break-all" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
              {typeof window !== 'undefined' ? window.location.origin : ''}/api/inbound/resend
            </code>
            <p className="text-[11px] mt-2" style={{ color: 'var(--text-tertiary)' }}>
              Required env var: <code className="font-mono px-1 rounded" style={{ background: 'var(--surface-secondary)' }}>RESEND_WEBHOOK_SECRET</code> — copy it from Resend&apos;s webhook detail page (Svix signing secret). Auto-reopen-on-reply fires from this webhook when a customer replies to a closed ticket.
            </p>
          </Section>
        </div>

        {error && <p className="mt-4 text-xs" style={{ color: 'var(--accent-red)' }}>{error}</p>}
        {saved && <p className="mt-4 text-xs" style={{ color: 'var(--accent-emerald)' }}>Saved.</p>}
      </div>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>{description}</p>
      {children}
    </div>
  )
}
