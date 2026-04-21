'use client'

import { useState } from 'react'

export default function SettingsClient({ initialAuditRetentionDays }: { initialAuditRetentionDays: number | null }) {
  const [retention, setRetention] = useState<string>(initialAuditRetentionDays?.toString() ?? '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null)

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const payload = retention.trim() === ''
        ? { auditRetentionDays: null }
        : { auditRetentionDays: Number(retention) }
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
      setMessage({ text: '✓ Saved.', tone: 'ok' })
    } catch (err: any) {
      setMessage({ text: err.message, tone: 'err' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 space-y-3">
        <div>
          <p className="text-sm font-medium text-zinc-200">Audit log retention</p>
          <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
            How long to keep rows in <span className="font-mono">AdminAuditLog</span>. Anything older
            than this is pruned by the daily retention cron. Leave empty to keep forever — our
            default for compliance use cases. Common values: 30, 90, 365.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={3650}
            value={retention}
            onChange={e => setRetention(e.target.value)}
            placeholder="Keep forever"
            className="w-40 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
          <span className="text-sm text-zinc-500">days</span>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="ml-auto inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {message && (
          <p className={`text-xs ${message.tone === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
            {message.text}
          </p>
        )}
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 space-y-2">
        <p className="text-sm font-medium text-zinc-200">Retention cron</p>
        <p className="text-xs text-zinc-500 leading-relaxed">
          Runs once daily at 03:30 UTC via Vercel Cron
          (<span className="font-mono">/api/cron/prune-audit-log</span>).
          Secured by <span className="font-mono">CRON_SECRET</span> — the same shared secret
          your other Vercel crons already use.
        </p>
      </section>
    </div>
  )
}
