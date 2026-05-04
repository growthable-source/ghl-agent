'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Suppression {
  id: string
  type: string
  value: string
  reason: string | null
  createdAt: string
}

export default function SuppressionsClient({
  workspaceId,
  initial,
}: {
  workspaceId: string
  initial: Suppression[]
}) {
  const router = useRouter()
  const [items, setItems] = useState(initial)
  const [type, setType] = useState<'email' | 'phone'>('email')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'email' | 'phone'>('all')

  const add = async () => {
    if (!value.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/native/suppressions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, value, reason: reason || 'manual' }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Failed')
      }
      // Optimistic add — value is normalised server-side, but for UI it's
      // close enough that a refresh will reconcile.
      setItems([
        { id: 'tmp-' + Date.now(), type, value: value.trim().toLowerCase(), reason: reason || 'manual', createdAt: new Date().toISOString() },
        ...items,
      ])
      setValue('')
      setReason('')
      router.refresh()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (item: Suppression) => {
    if (!confirm(`Un-suppress ${item.value}? Removing a STOP-reply entry without consent may be illegal in your jurisdiction.`)) return
    await fetch(`/api/workspaces/${workspaceId}/native/suppressions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: item.type, value: item.value }),
    })
    setItems(items.filter(i => i.id !== item.id))
    router.refresh()
  }

  const filtered = filter === 'all' ? items : items.filter(i => i.type === filter)

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Suppression list</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Workspace-wide opt-outs. Sends and imports skip anyone on this list.
          </p>
        </div>

        <div className="rounded-xl border p-4 mb-6 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Add suppression</p>
          <div className="flex flex-wrap gap-2 items-center">
            <select
              value={type}
              onChange={e => setType(e.target.value as 'email' | 'phone')}
              className="text-sm h-9 px-2 rounded-md border"
              style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)' }}
            >
              <option value="email">Email</option>
              <option value="phone">Phone</option>
            </select>
            <input
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder={type === 'email' ? 'name@example.com' : '+15551234567'}
              className="flex-1 min-w-[200px] text-sm h-9 px-2 rounded-md border"
              style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)' }}
            />
            <input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Reason (optional)"
              className="text-sm h-9 px-2 rounded-md border w-44"
              style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)' }}
            />
            <button
              onClick={add}
              disabled={busy || !value.trim()}
              className="text-xs font-semibold px-3 h-9 rounded-md transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
            >
              {busy ? 'Adding…' : 'Add'}
            </button>
          </div>
          {err && <p className="text-xs" style={{ color: 'var(--accent-red)' }}>{err}</p>}
        </div>

        <div className="flex items-center gap-2 mb-3">
          {(['all', 'email', 'phone'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="text-xs px-3 h-7 rounded-md border transition-colors"
              style={
                filter === f
                  ? { background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', borderColor: 'transparent' }
                  : { borderColor: 'var(--border-secondary)', color: 'var(--text-tertiary)' }
              }
            >
              {f === 'all' ? 'All' : f === 'email' ? 'Email' : 'Phone'}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div
            className="text-center py-12 border border-dashed rounded-xl"
            style={{ borderColor: 'var(--border-secondary)', background: 'var(--surface)' }}
          >
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No suppressions</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>STOP replies and bounces will land here automatically.</p>
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            {filtered.map((item, i) => (
              <div
                key={item.id}
                className="grid grid-cols-[80px_1fr_1fr_120px_80px] gap-3 items-center px-4 py-3"
                style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}
              >
                <span className="text-xs uppercase font-semibold" style={{ color: 'var(--text-tertiary)' }}>{item.type}</span>
                <span className="text-sm font-mono truncate" style={{ color: 'var(--text-primary)' }}>{item.value}</span>
                <span className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>{item.reason ?? '—'}</span>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{new Date(item.createdAt).toLocaleDateString()}</span>
                <button
                  onClick={() => remove(item)}
                  className="text-xs text-right transition-opacity hover:opacity-80"
                  style={{ color: 'var(--accent-red)' }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
