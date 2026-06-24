'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

export interface BrandOption {
  id: string
  name: string
  workspace?: { id: string; name: string } | null
}

interface BrandMultiSelectProps {
  options: BrandOption[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  placeholder?: string
  groupByWorkspace?: boolean
  disabled?: boolean
  id?: string
}

export default function BrandMultiSelect({
  options,
  selected,
  onChange,
  placeholder = 'Select brands',
  groupByWorkspace = false,
  disabled = false,
  id,
}: BrandMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close on outside mousedown + Escape (BannerDismissMenu idiom).
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Focus the search box when the panel opens.
  useEffect(() => {
    if (open) inputRef.current?.focus()
    else setQuery('')
  }, [open])

  const total = options.length
  const selectedCount = useMemo(
    () => options.reduce((n, o) => (selected.has(o.id) ? n + 1 : n), 0),
    [options, selected],
  )
  const allSelected = total > 0 && selectedCount === total

  const summary = selectedCount === 0
    ? placeholder
    : allSelected
      ? `All brands (${total})`
      : `${selectedCount} of ${total} selected`

  const q = query.trim().toLowerCase()
  const filtered = q
    ? options.filter(o =>
        o.name.toLowerCase().includes(q) ||
        (groupByWorkspace && (o.workspace?.name.toLowerCase().includes(q) ?? false)))
    : options

  // Group by workspace name, preserving a stable sorted order of headers.
  const groups = useMemo(() => {
    if (!groupByWorkspace) return null
    const map = new Map<string, BrandOption[]>()
    for (const o of filtered) {
      const key = o.workspace?.name ?? 'Other'
      const arr = map.get(key) ?? []
      arr.push(o)
      map.set(key, arr)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [filtered, groupByWorkspace])

  function toggle(optId: string) {
    const next = new Set(selected)
    if (next.has(optId)) next.delete(optId)
    else next.add(optId)
    onChange(next)
  }

  function selectAll() {
    // Select ALL options regardless of the current filter.
    onChange(new Set(options.map(o => o.id)))
  }

  function clearAll() {
    onChange(new Set())
  }

  function renderRow(o: BrandOption) {
    const on = selected.has(o.id)
    return (
      <button
        key={o.id}
        type="button"
        role="option"
        aria-selected={on}
        onClick={() => toggle(o.id)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-800 transition-colors"
      >
        <span
          className={
            'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ' +
            (on ? 'bg-amber-400 border-amber-400' : 'bg-zinc-900 border-zinc-600')
          }
        >
          {on && (
            <svg className="h-3 w-3 text-zinc-950" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </span>
        <span className="truncate">{o.name}</span>
      </button>
    )
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 hover:border-zinc-600 focus:border-amber-400 outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <span className={selectedCount === 0 ? 'text-zinc-500' : 'text-zinc-100'}>{summary}</span>
        <svg
          className={'h-4 w-4 shrink-0 text-zinc-400 transition-transform ' + (open ? 'rotate-180' : '')}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute z-50 mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 shadow-xl overflow-hidden"
        >
          <div className="sticky top-0 bg-zinc-950 border-b border-zinc-800 p-2 space-y-2">
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={groupByWorkspace ? 'Search brands or workspaces…' : 'Search brands…'}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-amber-400 outline-none"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={selectAll}
                disabled={allSelected}
                className="px-2 py-0.5 rounded text-xs text-zinc-300 border border-zinc-700 hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={clearAll}
                disabled={selectedCount === 0}
                className="px-2 py-0.5 rounded text-xs text-zinc-300 border border-zinc-700 hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-xs text-zinc-500">No brands match</p>
            ) : groupByWorkspace && groups ? (
              groups.map(([wsName, list]) => (
                <div key={wsName} className="mb-1">
                  <p className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider text-zinc-500">{wsName}</p>
                  {list.map(renderRow)}
                </div>
              ))
            ) : (
              filtered.map(renderRow)
            )}
          </div>
        </div>
      )}
    </div>
  )
}
