'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface Current {
  brand: string; q: string; channel: string; handled: string; status: string; from: string; to: string
}

const selectCls = 'rounded-lg px-2.5 py-2 text-xs text-zinc-200 focus:outline-none'
const selectStyle = { background: 'var(--input-bg)', border: '1px solid var(--input-border)' } as const

export default function ConversationFilters({
  brands, current,
}: {
  brands: Array<{ name: string; slug: string }>
  current: Current
}) {
  const router = useRouter()
  const [q, setQ] = useState(current.q)

  // Push the new filter set to the URL (server re-renders). Page always
  // resets to 1 — empty values are dropped so the URL stays clean.
  function apply(patch: Partial<Current>) {
    const next = { ...current, ...patch }
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(next)) if (v) params.set(k, v)
    const qs = params.toString()
    router.push(`/portal/conversations${qs ? `?${qs}` : ''}`)
  }

  const activeChips = [
    current.brand && { k: 'brand', label: brands.find(b => b.slug === current.brand)?.name ?? current.brand },
    current.channel && { k: 'channel', label: current.channel === 'voice' ? 'Voice' : 'Live Chat' },
    current.handled && { k: 'handled', label: current.handled === 'ai' ? 'AI-handled' : 'Human-handled' },
    current.status && { k: 'status', label: current.status === 'ended' ? 'Ended' : 'Active' },
    current.q && { k: 'q', label: `“${current.q}”` },
    (current.from || current.to) && { k: 'date', label: `${current.from || '…'} → ${current.to || '…'}` },
  ].filter(Boolean) as Array<{ k: string; label: string }>

  return (
    <div className="mt-4 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={e => { e.preventDefault(); apply({ q }) }}
          className="flex-1 min-w-[220px]"
        >
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search by customer, email, or session ID…"
            className="w-full rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none"
            style={selectStyle}
          />
        </form>

        <select value={current.brand} onChange={e => apply({ brand: e.target.value })} className={selectCls} style={selectStyle}>
          <option value="">All brands</option>
          {brands.map(b => <option key={b.slug} value={b.slug}>{b.name}</option>)}
        </select>
        <select value={current.channel} onChange={e => apply({ channel: e.target.value })} className={selectCls} style={selectStyle}>
          <option value="">All channels</option>
          <option value="live_chat">Live Chat</option>
          <option value="voice">Voice</option>
        </select>
        <select value={current.handled} onChange={e => apply({ handled: e.target.value })} className={selectCls} style={selectStyle}>
          <option value="">Handled by anyone</option>
          <option value="ai">AI agent</option>
          <option value="human">Human</option>
        </select>
        <select value={current.status} onChange={e => apply({ status: e.target.value })} className={selectCls} style={selectStyle}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="ended">Ended</option>
        </select>
        <input type="date" value={current.from} onChange={e => apply({ from: e.target.value })} className={selectCls} style={selectStyle} title="From" />
        <input type="date" value={current.to} onChange={e => apply({ to: e.target.value })} className={selectCls} style={selectStyle} title="To" />
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mr-1">Active</span>
          {activeChips.map(c => (
            <button
              key={c.k}
              onClick={() => apply(c.k === 'date' ? { from: '', to: '' } : { [c.k]: '' } as Partial<Current>)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] border border-zinc-700 text-zinc-300 hover:border-zinc-500"
            >
              {c.label} <span className="text-zinc-500">×</span>
            </button>
          ))}
          <button
            onClick={() => router.push('/portal/conversations')}
            className="text-[11px] text-[var(--portal-accent)] hover:underline ml-1"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}
