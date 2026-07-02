'use client'

/**
 * Searchable, filterable agency-location list with per-row and bulk
 * widget on/off toggles. Shared between the workspace dashboard
 * (/dashboard/[workspaceId]/locations) and the customer portal
 * (/portal/locations) — pass the right API base for each surface:
 *   dashboard: /api/workspaces/<wsId>/widgets/<widgetId>/locations
 *   portal:    /api/portal/locations
 * Both bases expose GET (list), PATCH (bulk toggle), POST /sync.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

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
    return <div className="p-6 text-sm text-zinc-500">{error ?? 'Loading locations…'}</div>
  }

  const rows = data.locations
  const allOnPageSelected = rows.length > 0 && rows.every(r => selected.has(r.id))
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize))

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-zinc-800 bg-accent-red-bg px-4 py-2 text-sm text-accent-red">
          {error}
        </div>
      )}
      {data.needsReconnect && (
        <div className="rounded-lg border border-zinc-800 bg-accent-amber-bg px-4 py-2 text-sm text-accent-amber">
          The agency connection needs to be reconnected — location data may be stale.
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={e => onSearch(e.target.value)}
          placeholder="Search name, email, city, or location ID…"
          className="w-72 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
        />
        <div className="flex rounded-lg border border-zinc-800 overflow-hidden text-sm">
          {(['all', 'on', 'off'] as const).map(f => (
            <button
              key={f}
              onClick={() => { setFilter(f); setPage(1) }}
              className={`px-3 py-2 ${filter === f ? 'bg-zinc-800 text-zinc-100' : 'bg-zinc-900 text-zinc-500 hover:text-zinc-300'}`}
            >
              {f === 'all' ? `All (${data.total})` : f === 'on' ? 'Widget on' : 'Widget off'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-zinc-500">
          {data.lastSyncedAt && <span>Synced {new Date(data.lastSyncedAt).toLocaleString()}</span>}
          <button
            onClick={syncNow}
            disabled={syncing || !canManage}
            className="rounded-lg border border-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
          >
            {syncing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Bulk bar */}
      {canManage && selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm">
          <span className="text-zinc-300">{selected.size} selected</span>
          <button
            onClick={() => applyToggle([...selected], true)}
            disabled={busy}
            className="rounded-md bg-accent-primary-bg px-3 py-1.5 text-accent-primary disabled:opacity-50"
          >
            Turn widget on
          </button>
          <button
            onClick={() => applyToggle([...selected], false)}
            disabled={busy}
            className="rounded-md bg-accent-red-bg px-3 py-1.5 text-accent-red disabled:opacity-50"
          >
            Turn widget off
          </button>
          <button onClick={() => setSelected(new Set())} className="text-zinc-500 hover:text-zinc-300">
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <div className="grid grid-cols-[auto_1fr_1fr_1fr_auto] items-center gap-x-4 border-b border-zinc-800 bg-zinc-900 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
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
          <div className="px-4 py-8 text-center text-sm text-zinc-500">
            No locations match{q ? ` “${q}”` : ''}.
          </div>
        )}
        {rows.map(r => (
          <div
            key={r.id}
            className="grid grid-cols-[auto_1fr_1fr_1fr_auto] items-center gap-x-4 border-b border-zinc-800 last:border-b-0 px-4 py-3 text-sm hover:bg-zinc-900/50"
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
                  style={{ accentColor: 'var(--accent-primary)' }}
                />
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-zinc-100">{r.name}</span>
              <span className="block truncate text-xs text-zinc-500">
                {[r.city, r.state, r.country].filter(Boolean).join(', ') || '—'}
              </span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-zinc-300">{r.email ?? '—'}</span>
              <span className="block truncate text-xs text-zinc-500">{r.phone ?? ''}</span>
            </span>
            <span className="truncate font-mono text-xs text-zinc-500">{r.locationId}</span>
            <span className="text-right">
              <button
                type="button"
                onClick={() => applyToggle([r.id], !r.widgetEnabled)}
                disabled={!canManage || busy}
                role="switch"
                aria-checked={r.widgetEnabled}
                className="shrink-0 w-10 h-6 rounded-full transition-colors disabled:opacity-40"
                style={{ background: r.widgetEnabled ? 'var(--accent-primary)' : 'var(--surface-tertiary)' }}
              >
                <span
                  className="block w-5 h-5 rounded-full bg-white transition-transform"
                  style={{ transform: r.widgetEnabled ? 'translateX(18px)' : 'translateX(2px)' }}
                />
              </button>
            </span>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-zinc-500">
          <span>Page {data.page} of {totalPages} · {data.total} locations</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={data.page <= 1}
              className="rounded-lg border border-zinc-800 px-3 py-1.5 hover:bg-zinc-900 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={data.page >= totalPages}
              className="rounded-lg border border-zinc-800 px-3 py-1.5 hover:bg-zinc-900 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
