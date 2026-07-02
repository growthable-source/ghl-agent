'use client'

/**
 * Searchable, filterable agency-location list with per-row and bulk
 * widget on/off toggles. Shared between the workspace dashboard
 * (/dashboard/[workspaceId]/widgets/[widgetId]/locations) and the
 * customer portal (/portal/locations) — pass the right API base for
 * each surface:
 *   dashboard: /api/workspaces/<wsId>/widgets/<widgetId>/locations
 *   portal:    /api/portal/locations
 * Both bases expose GET (list), PATCH (bulk toggle), POST /sync.
 *
 * Styling: inline style={{}} with the semantic CSS vars (the idiom of
 * the newest dashboard pages) — not raw zinc classes, and never
 * bg-white (remapped to brand orange by globals.css).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Toggle from '@/components/ui/Toggle'

interface LocationRow {
  id: string
  locationId: string
  name: string
  city: string | null
  state: string | null
  country: string | null
  email: string | null
  phone: string | null
  widgetEnabled: boolean
  widgetEnabledUpdatedAt: string | null
  lastSyncedAt: string
}

interface ListResponse {
  connected: boolean
  needsReconnect?: boolean
  locations: LocationRow[]
  total: number
  enabledCount: number
  page: number
  pageSize: number
  lastSyncedAt: string | null
}

// Per-page helper by app convention (no shared date lib).
function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function LocationList({
  apiBase,
  canManage,
}: {
  apiBase: string
  canManage: boolean
}) {
  const [data, setData] = useState<ListResponse | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (query: string, f: string, p: number) => {
    try {
      const res = await fetch(`${apiBase}?q=${encodeURIComponent(query)}&filter=${f}&page=${p}`)
      if (!res.ok) throw new Error(`Load failed (${res.status})`)
      setData(await res.json())
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load locations')
    }
  }, [apiBase])

  // q is deliberately absent — search reloads through the debounce below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(q, filter, page) }, [load, filter, page])

  function onSearch(value: string) {
    setQ(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setPage(1); load(value, filter, 1) }, 300)
  }

  async function applyToggle(ids: string[], widgetEnabled: boolean) {
    if (!canManage || ids.length === 0) return
    setBusy(true)
    try {
      const res = await fetch(apiBase, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, widgetEnabled }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Update failed')
      setSelected(new Set())
      await load(q, filter, page)
    } catch (e: any) {
      setError(e?.message ?? 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  async function syncNow() {
    setSyncing(true)
    try {
      const res = await fetch(`${apiBase}/sync`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Sync failed')
      await load(q, filter, page)
    } catch (e: any) {
      setError(e?.message ?? 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  if (!data) {
    return (
      <div className="p-6 text-sm" style={{ color: 'var(--text-tertiary)' }}>
        {error ?? 'Loading locations…'}
      </div>
    )
  }

  const rows = data.locations
  const allOnPageSelected = rows.length > 0 && rows.every(r => selected.has(r.id))
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize))
  const ghostBtn = {
    borderColor: 'var(--border)',
    color: 'var(--text-secondary)',
  } as const

  return (
    <div className="space-y-4">
      {error && (
        <div
          className="rounded-lg border px-4 py-2.5 text-sm"
          style={{ borderColor: 'var(--accent-red)', background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}
        >
          {error}
        </div>
      )}
      {data.needsReconnect && (
        <div
          className="rounded-lg border px-4 py-2.5 text-sm"
          style={{ borderColor: 'var(--accent-amber)', background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }}
        >
          The agency connection needs to be reconnected — location data may be stale.
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={e => onSearch(e.target.value)}
          placeholder="Search name, email, city, or location ID…"
          className="w-72 rounded-lg border px-3 py-2 text-sm focus:outline-none transition-colors"
          style={{
            background: 'var(--input-bg)',
            borderColor: 'var(--input-border)',
            color: 'var(--input-text)',
          }}
        />
        <div
          className="flex rounded-lg border overflow-hidden text-sm"
          style={{ borderColor: 'var(--border)' }}
        >
          {(['all', 'on', 'off'] as const).map(f => {
            const active = filter === f
            return (
              <button
                key={f}
                onClick={() => { setFilter(f); setPage(1) }}
                className="px-3 py-2 transition-colors"
                style={
                  active
                    ? { background: 'var(--surface-tertiary)', color: 'var(--text-primary)', fontWeight: 500 }
                    : { background: 'var(--surface)', color: 'var(--text-tertiary)' }
                }
              >
                {f === 'all' ? `All (${data.total})` : f === 'on' ? 'Widget on' : 'Widget off'}
              </button>
            )
          })}
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {data.lastSyncedAt && (
            <span title={new Date(data.lastSyncedAt).toLocaleString()}>
              Synced {timeAgo(data.lastSyncedAt)}
            </span>
          )}
          <button
            onClick={syncNow}
            disabled={syncing || !canManage}
            className="rounded-lg border px-3 py-2 text-sm transition-colors hover:opacity-80 disabled:opacity-50"
            style={ghostBtn}
          >
            {syncing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Bulk bar */}
      {canManage && selected.size > 0 && (
        <div
          className="flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <span style={{ color: 'var(--text-secondary)' }}>{selected.size} selected</span>
          <button
            onClick={() => applyToggle([...selected], true)}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }}
          >
            Turn widget on
          </button>
          <button
            onClick={() => applyToggle([...selected], false)}
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}
          >
            Turn widget off
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs transition-opacity hover:opacity-70"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div
          className="grid grid-cols-[auto_1fr_1fr_1fr_auto] items-center gap-x-4 border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}
        >
          <span className="w-4">
            {canManage && (
              <input
                type="checkbox"
                checked={allOnPageSelected}
                onChange={() => {
                  const next = new Set(selected)
                  if (allOnPageSelected) rows.forEach(r => next.delete(r.id))
                  else rows.forEach(r => next.add(r.id))
                  setSelected(next)
                }}
                className="w-4 h-4 rounded cursor-pointer align-middle"
                style={{ accentColor: 'var(--accent-primary)' }}
              />
            )}
          </span>
          <span>Location</span>
          <span>Contact</span>
          <span>Location ID</span>
          <span className="text-right">Widget</span>
        </div>
        {rows.length === 0 && (
          <div className="px-4 py-10 text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {q || filter !== 'all'
              ? <>No locations match{q ? <> “{q}”</> : null}. Try a different search or filter.</>
              : 'No locations synced yet. Hit Refresh to pull them from your agency.'}
          </div>
        )}
        {rows.map(r => (
          <div
            key={r.id}
            className="group grid grid-cols-[auto_1fr_1fr_1fr_auto] items-center gap-x-4 border-b last:border-b-0 px-4 py-3 text-sm transition-colors hover:bg-zinc-900/50"
            style={{ borderColor: 'var(--border)' }}
          >
            <span className="w-4">
              {canManage && (
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => {
                    const next = new Set(selected)
                    if (next.has(r.id)) next.delete(r.id)
                    else next.add(r.id)
                    setSelected(next)
                  }}
                  className="w-4 h-4 rounded cursor-pointer align-middle"
                  style={{ accentColor: 'var(--accent-primary)' }}
                />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium" style={{ color: 'var(--text-primary)' }}>{r.name}</span>
              <span className="block truncate text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                {[r.city, r.state, r.country].filter(Boolean).join(', ') || '—'}
              </span>
            </span>
            <span className="min-w-0">
              <span className="block truncate" style={{ color: 'var(--text-secondary)' }}>{r.email ?? '—'}</span>
              <span className="block truncate text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{r.phone ?? ''}</span>
            </span>
            <span className="truncate font-mono text-[11px] select-all" style={{ color: 'var(--text-muted)' }} title={r.locationId}>
              {r.locationId}
            </span>
            <span className="flex justify-end">
              <Toggle
                checked={r.widgetEnabled}
                onChange={next => applyToggle([r.id], next)}
                disabled={!canManage || busy}
                title={r.widgetEnabled ? 'Widget is on — click to turn off for this location' : 'Widget is off — click to turn on for this location'}
              />
            </span>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-tertiary)' }}>
          <span>Page {data.page} of {totalPages} · {data.total} locations</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={data.page <= 1}
              className="rounded-lg border px-3 py-1.5 transition-colors hover:opacity-80 disabled:opacity-50"
              style={ghostBtn}
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={data.page >= totalPages}
              className="rounded-lg border px-3 py-1.5 transition-colors hover:opacity-80 disabled:opacity-50"
              style={ghostBtn}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
