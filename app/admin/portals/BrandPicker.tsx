'use client'

import { useState } from 'react'

// Cross-workspace brand picker shared by the New-portal form and the
// portal detail page's catalog editor. A portal is not scoped to any one
// workspace, so the list is every brand on the platform, grouped by its
// workspace. Search matches brand name, workspace name, or an exact
// brand / workspace ID — support often has an ID from a ticket or the
// Workspaces tab rather than a name.

export interface BrandWithWorkspace {
  id: string
  name: string
  slug: string
  workspace: { id: string; name: string }
}

export default function BrandPicker({
  allBrands, selected, onToggle,
}: {
  allBrands: BrandWithWorkspace[]
  selected: Set<string>
  onToggle: (id: string) => void
}) {
  const [query, setQuery] = useState('')

  const raw = query.trim()
  const q = raw.toLowerCase()
  const visible = q
    ? allBrands.filter(b =>
        b.name.toLowerCase().includes(q) ||
        b.workspace.name.toLowerCase().includes(q) ||
        b.id === raw ||
        b.workspace.id === raw,
      )
    : allBrands
  // Grouped by workspace id (names aren't unique), labelled by name.
  const groups = new Map<string, { name: string; list: BrandWithWorkspace[] }>()
  for (const b of visible) {
    const g = groups.get(b.workspace.id) ?? { name: b.workspace.name, list: [] }
    g.list.push(b)
    groups.set(b.workspace.id, g)
  }

  return (
    <>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search brands or workspaces, or paste a brand / workspace ID…"
        className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 outline-none mb-3"
      />
      <div className="max-h-80 overflow-y-auto space-y-4">
        {Array.from(groups.entries()).map(([wsId, { name, list }]) => (
          <div key={wsId}>
            <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">{name}</p>
            <div className="flex flex-wrap gap-2">
              {list.map(b => {
                const on = selected.has(b.id)
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onToggle(b.id)}
                    className={
                      'px-2.5 py-1 rounded text-xs border transition-colors ' +
                      (on
                        ? 'bg-amber-400 text-zinc-950 border-amber-400'
                        : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-600')
                    }
                  >
                    {b.name}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        {allBrands.length === 0 && <p className="text-xs text-zinc-500">No brands exist in any workspace yet.</p>}
        {allBrands.length > 0 && visible.length === 0 && (
          <p className="text-xs text-zinc-500">No brands match “{raw}”.</p>
        )}
      </div>
    </>
  )
}
