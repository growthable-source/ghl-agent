'use client'

/**
 * Brand priority groups.
 *
 * Operators sort brands into named priority buckets (VIP, Standard,
 * Low-priority, etc.) and order the buckets. The inbox sorts incoming
 * conversations by group priority FIRST, then recency — so a chat
 * from a top-tier brand jumps ahead of the queue even if it arrived
 * later.
 *
 * "All else equally" is implicit: brands not in any group fall
 * through to the lowest tier on sort.
 *
 * Page is split-pane: groups on the left (with drag-style "Move up /
 * down" buttons to reorder via priority), brand-assignment on the
 * right when a group is selected.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface Brand {
  id: string
  name: string
  slug: string
  brandGroupId?: string | null
  logoUrl: string | null
  primaryColor: string | null
}

interface Group {
  id: string
  name: string
  description: string | null
  priority: number
  color: string | null
  brandCount: number
}

const PRESET_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b']

export default function BrandGroupsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [groups, setGroups] = useState<Group[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [notMigrated, setNotMigrated] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editingName, setEditingName] = useState('')
  const [editingColor, setEditingColor] = useState<string | null>(null)
  const [editingPriority, setEditingPriority] = useState(100)
  const [busy, setBusy] = useState(false)
  const [addSearch, setAddSearch] = useState('')

  const load = useCallback(async () => {
    try {
      const [g, b] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/brand-groups`).then(r => r.json()),
        fetch(`/api/workspaces/${workspaceId}/brands`).then(r => r.json()),
      ])
      setGroups(g.groups || [])
      setNotMigrated(!!g.notMigrated)
      // Brand list response is `{ brands: [...] }`. We don't currently
      // surface brandGroupId on that endpoint — fetch the assignment
      // by listing brands per group via the count above and the
      // detail panel calling Brand PATCH directly.
      setBrands((b.brands || []).map((br: any) => ({
        id: br.id, name: br.name, slug: br.slug,
        logoUrl: br.logoUrl, primaryColor: br.primaryColor,
        brandGroupId: br.brandGroupId ?? null,
      })))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { load() }, [load])

  const selected = groups.find(g => g.id === selectedId) ?? null

  // Sync the editor form when the selected group changes.
  useEffect(() => {
    if (selected) {
      setEditingName(selected.name)
      setEditingColor(selected.color)
      setEditingPriority(selected.priority)
    }
  }, [selectedId])  // eslint-disable-line react-hooks/exhaustive-deps

  async function createGroup() {
    const name = prompt('Name for the new priority group? (e.g. "VIP", "Standard")')
    if (!name?.trim()) return
    setCreating(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/brand-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error || 'Failed to create group'); return }
      await load()
      setSelectedId(data.group.id)
    } finally { setCreating(false) }
  }

  async function saveDetails() {
    if (!selected) return
    setBusy(true)
    try {
      await fetch(`/api/workspaces/${workspaceId}/brand-groups/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editingName.trim() || selected.name,
          color: editingColor,
          priority: editingPriority,
        }),
      })
      await load()
    } finally { setBusy(false) }
  }

  async function move(direction: 'up' | 'down') {
    if (!selected) return
    // Bubble priority by ±5 — preserves headroom for inserting new
    // groups between existing ones without renumbering every row.
    const delta = direction === 'up' ? -5 : 5
    const next = Math.max(0, Math.min(9999, selected.priority + delta))
    if (next === selected.priority) return
    setBusy(true)
    try {
      await fetch(`/api/workspaces/${workspaceId}/brand-groups/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: next }),
      })
      await load()
    } finally { setBusy(false) }
  }

  async function moveBrandIntoSelected(brand: Brand) {
    if (!selected || brand.brandGroupId === selected.id) return
    // Confirm reassignment when brand currently lives in another
    // group — operators occasionally click the wrong row and a
    // silent move is hard to undo without checking the old group.
    if (brand.brandGroupId) {
      const fromName = groups.find(g => g.id === brand.brandGroupId)?.name ?? 'another group'
      if (!confirm(`Move "${brand.name}" from "${fromName}" to "${selected.name}"?`)) return
    }
    setBusy(true)
    try {
      await fetch(`/api/workspaces/${workspaceId}/brands/${brand.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandGroupId: selected.id }),
      })
      await load()
      setAddSearch('')
    } finally { setBusy(false) }
  }

  async function removeBrandFromSelected(brand: Brand) {
    if (!selected) return
    setBusy(true)
    try {
      await fetch(`/api/workspaces/${workspaceId}/brands/${brand.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandGroupId: null }),
      })
      await load()
    } finally { setBusy(false) }
  }

  async function deleteGroup() {
    if (!selected) return
    if (!confirm(`Delete the "${selected.name}" group? Brands in it become ungrouped.`)) return
    setBusy(true)
    try {
      await fetch(`/api/workspaces/${workspaceId}/brand-groups/${selected.id}`, { method: 'DELETE' })
      setSelectedId(null)
      await load()
    } finally { setBusy(false) }
  }

  if (loading) return (
    <div className="flex-1 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="h-8 w-40 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
      </div>
    </div>
  )

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Brand priority groups</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Sort brands into priority buckets. The inbox surfaces conversations from higher-priority groups first when humans are needed.
            </p>
          </div>
          <button
            onClick={createGroup}
            disabled={creating || notMigrated}
            className="text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
          >
            {creating ? 'Creating…' : '+ New group'}
          </button>
        </div>

        {notMigrated && (
          <div className="rounded-xl p-4 mb-6" style={{ background: 'var(--accent-amber-bg)', border: '1px solid var(--accent-amber-bg)' }}>
            <p className="text-sm" style={{ color: 'var(--accent-amber)' }}>
              Run <code className="bg-black/30 px-1 rounded">prisma/migrations-legacy/manual_brand_groups.sql</code> to enable brand priority groups.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* Groups list — ordered by priority, lowest number first. */}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="px-4 py-2 border-b text-[10px] uppercase tracking-wider font-semibold"
              style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}>
              {groups.length} group{groups.length === 1 ? '' : 's'}
            </div>
            {groups.length === 0 ? (
              <p className="p-6 text-xs text-center" style={{ color: 'var(--text-tertiary)' }}>
                No groups yet. Create one to start prioritising brands.
              </p>
            ) : (
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {groups.map(g => (
                  <button
                    key={g.id}
                    onClick={() => setSelectedId(g.id)}
                    className="w-full text-left p-3 transition-colors"
                    style={{
                      background: selectedId === g.id ? 'var(--surface-tertiary)' : 'transparent',
                      borderTop: '1px solid var(--border)',
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded flex-shrink-0"
                        style={{ background: g.color || 'var(--surface-secondary)', border: g.color ? undefined : '1px solid var(--border)' }}
                      />
                      <p className="text-sm font-semibold flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{g.name}</p>
                      <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>P{g.priority}</span>
                    </div>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {g.brandCount} brand{g.brandCount === 1 ? '' : 's'}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Detail panel. */}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            {!selected ? (
              <div className="p-8 text-center">
                <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                  {groups.length === 0
                    ? 'Create your first group to get started.'
                    : 'Pick a group from the left to edit it and assign brands.'}
                </p>
              </div>
            ) : (
              <div>
                <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center gap-2">
                    <input
                      value={editingName}
                      onChange={e => setEditingName(e.target.value)}
                      className="flex-1 text-base font-semibold bg-transparent outline-none border-b border-transparent focus:border-zinc-700 transition-colors"
                      style={{ color: 'var(--text-primary)' }}
                    />
                    <button
                      onClick={() => move('up')}
                      disabled={busy}
                      className="text-xs px-2 py-1 rounded border hover:bg-zinc-900 disabled:opacity-40"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      title="Raise priority"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move('down')}
                      disabled={busy}
                      className="text-xs px-2 py-1 rounded border hover:bg-zinc-900 disabled:opacity-40"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      title="Lower priority"
                    >
                      ↓
                    </button>
                    <button
                      onClick={deleteGroup}
                      disabled={busy}
                      className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>Priority</span>
                      <input
                        type="number"
                        value={editingPriority}
                        onChange={e => setEditingPriority(Math.max(0, Math.min(9999, Number(e.target.value) || 0)))}
                        className="px-2 py-1 rounded"
                        style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
                      />
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Lower number = higher priority. Default 100.</span>
                    </label>
                    <div>
                      <span className="text-[10px] uppercase tracking-wider font-semibold block mb-1" style={{ color: 'var(--text-tertiary)' }}>Colour</span>
                      <div className="flex gap-1.5 flex-wrap">
                        <button
                          onClick={() => setEditingColor(null)}
                          className="w-7 h-7 rounded border-2 text-[10px] flex items-center justify-center"
                          style={{ borderColor: editingColor === null ? 'var(--text-primary)' : 'transparent', background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}
                          aria-label="No colour"
                          title="No colour"
                        >
                          ×
                        </button>
                        {PRESET_COLORS.map(c => (
                          <button
                            key={c}
                            onClick={() => setEditingColor(c)}
                            className="w-7 h-7 rounded border-2"
                            style={{ background: c, borderColor: editingColor === c ? 'var(--text-primary)' : 'transparent' }}
                            aria-label={c}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={saveDetails}
                      disabled={busy}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
                      style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
                    >
                      {busy ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>

                {/* Members of this group */}
                {(() => {
                  const members = brands.filter(b => b.brandGroupId === selected.id)
                  return (
                    <>
                      <div className="px-4 py-2 border-b text-[10px] uppercase tracking-wider font-semibold flex items-center justify-between"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}>
                        <span>Members · {members.length}</span>
                      </div>
                      {members.length === 0 ? (
                        <p className="p-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                          No brands assigned yet. Use the search below to add some.
                        </p>
                      ) : (
                        members.map(b => (
                          <div
                            key={b.id}
                            className="flex items-center gap-3 p-3 border-t"
                            style={{ borderColor: 'var(--border)' }}
                          >
                            {b.logoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={b.logoUrl} alt="" className="w-6 h-6 rounded object-cover" />
                            ) : (
                              <span
                                className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-semibold text-white"
                                style={{ background: b.primaryColor || '#fa4d2e' }}
                              >
                                {b.name.charAt(0).toUpperCase()}
                              </span>
                            )}
                            <p className="text-sm flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{b.name}</p>
                            <button
                              onClick={() => removeBrandFromSelected(b)}
                              disabled={busy}
                              className="text-[11px] text-zinc-400 hover:text-red-400 disabled:opacity-50"
                            >
                              Remove
                            </button>
                          </div>
                        ))
                      )}
                    </>
                  )
                })()}

                {/* Add-brand search. Search-driven so 100+ brand workspaces
                    don't get a wall of checkboxes; brands are typeahead-able
                    by name or slug, results capped at 8. Each result row
                    shows the brand's CURRENT group so an operator knows
                    they're about to MOVE it rather than co-locate. */}
                <div className="px-4 py-2 border-t border-b text-[10px] uppercase tracking-wider font-semibold"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}>
                  Add brand
                </div>
                <div className="p-3 border-b" style={{ borderColor: 'var(--border)' }}>
                  <input
                    type="text"
                    value={addSearch}
                    onChange={e => setAddSearch(e.target.value)}
                    placeholder="Search by name or slug…"
                    className="w-full text-sm rounded px-2.5 py-1.5"
                    style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
                  />
                </div>
                {(() => {
                  const q = addSearch.trim().toLowerCase()
                  const candidates = brands.filter(b => b.brandGroupId !== selected.id)
                  // Empty search: show first 8 ungrouped brands (cheap
                  // "what could I add" hint without a wall of text).
                  const filtered = q
                    ? candidates.filter(b =>
                        b.name.toLowerCase().includes(q)
                        || b.slug.toLowerCase().includes(q),
                      )
                    : candidates.filter(b => !b.brandGroupId)
                  if (filtered.length === 0) {
                    return (
                      <p className="p-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        {q
                          ? 'No brands match. Note: a brand can only live in one group at a time.'
                          : 'No ungrouped brands left. Type a name to search across all brands — adding from another group will MOVE it.'}
                      </p>
                    )
                  }
                  return filtered.slice(0, 8).map(b => {
                    const currentGroup = b.brandGroupId ? groups.find(g => g.id === b.brandGroupId) : null
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => moveBrandIntoSelected(b)}
                        disabled={busy}
                        className="w-full flex items-center gap-3 p-3 border-t text-left hover:bg-zinc-900/40 transition-colors disabled:opacity-50"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        {b.logoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={b.logoUrl} alt="" className="w-6 h-6 rounded object-cover" />
                        ) : (
                          <span
                            className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-semibold text-white"
                            style={{ background: b.primaryColor || '#fa4d2e' }}
                          >
                            {b.name.charAt(0).toUpperCase()}
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{b.name}</p>
                          {currentGroup ? (
                            <p className="text-[10px]" style={{ color: 'var(--accent-amber)' }}>
                              Will move from <span className="font-medium">{currentGroup.name}</span>
                            </p>
                          ) : (
                            <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Ungrouped</p>
                          )}
                        </div>
                        <span className="text-[11px] font-semibold" style={{ color: 'var(--accent-primary)' }}>
                          + Add
                        </span>
                      </button>
                    )
                  })
                })()}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
