'use client'

/**
 * Portal-side control for scheduled email reports (the admin has the
 * same setting on the super-admin portal page). Self-fetching so the
 * settings page stays a simple server component.
 */

import { useEffect, useState } from 'react'

export default function ReportScheduleCard() {
  const [frequency, setFrequency] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/portal/report-settings')
      .then(r => r.json())
      .then(d => setFrequency(d.reportFrequency ?? 'off'))
      .catch(() => setFrequency('off'))
  }, [])

  async function save(next: string) {
    setFrequency(next)
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch('/api/portal/report-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportFrequency: next }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Save failed')
      setMsg('Saved')
      setTimeout(() => setMsg(null), 2000)
    } catch (e: any) {
      setMsg(e?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 p-5" style={{ background: 'var(--surface)' }}>
      <p className="text-sm font-medium text-zinc-100">Email reports</p>
      <p className="text-xs text-zinc-500 mt-1 mb-3 max-w-lg">
        Get your support summary by email — conversations handled, estimated time saved,
        anything outstanding or urgent, and AI insights on what your customers keep asking about.
        Sent to every active user of this portal.
      </p>
      {frequency === null ? (
        <div className="h-8 w-40 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
      ) : (
        <div className="flex items-center gap-2">
          {(['off', 'daily', 'weekly'] as const).map(f => (
            <button
              key={f}
              type="button"
              disabled={saving}
              onClick={() => save(f)}
              className="text-sm px-3.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
              style={
                frequency === f
                  ? { borderColor: 'var(--portal-accent)', color: 'var(--portal-accent)', background: 'color-mix(in srgb, var(--portal-accent) 10%, transparent)' }
                  : { borderColor: 'var(--border)', color: 'var(--text-tertiary)' }
              }
            >
              {f === 'off' ? 'Off' : f === 'daily' ? 'Daily' : 'Weekly'}
            </button>
          ))}
          {msg && <span className="text-xs text-zinc-500">{msg}</span>}
        </div>
      )}
    </div>
  )
}
