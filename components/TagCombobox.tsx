'use client'

import { useEffect, useState, useRef } from 'react'

interface Tag {
  id: string
  name: string
}

interface TagComboboxProps {
  workspaceId: string
  locationId: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
}

/**
 * Autocomplete tag picker:
 * - fetches existing tags from the connected GHL location
 * - filters as the user types
 * - shows a "+ Create" option when no exact match
 * - on create, POSTs to GHL to persist the new tag
 */
export default function TagCombobox({
  workspaceId,
  locationId,
  value,
  onChange,
  placeholder = 'Start typing a tag name...',
  required,
}: TagComboboxProps) {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Fetch tags once
  useEffect(() => {
    if (!locationId) { setLoading(false); return }
    fetch(`/api/workspaces/${workspaceId}/locations/${locationId}/tags`)
      .then(r => r.json())
      .then(data => {
        setTags(data.tags || [])
        if (data.error) setError(data.error)
        if (data.code) setErrorCode(data.code)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [workspaceId, locationId])

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const lower = value.trim().toLowerCase()
  const filtered = lower
    ? tags.filter(t => t.name.toLowerCase().includes(lower)).slice(0, 10)
    : tags.slice(0, 10)
  const exactMatch = tags.some(t => t.name.toLowerCase() === lower)
  const canCreate = lower.length > 0 && !exactMatch

  async function createNewTag() {
    if (!value.trim()) return
    setCreating(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/locations/${locationId}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: value.trim() }),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.tag) {
          setTags(prev => [...prev, data.tag])
          onChange(data.tag.name)
          setOpen(false)
        }
      }
    } finally { setCreating(false) }
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={loading ? 'Loading tags...' : placeholder}
        required={required}
        disabled={loading}
        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
      />

      {open && !loading && (filtered.length > 0 || canCreate) && (
        <div className="absolute top-full left-0 right-0 mt-1 max-h-60 overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl z-20">
          {filtered.map(tag => (
            <button
              key={tag.id}
              type="button"
              onClick={() => { onChange(tag.name); setOpen(false) }}
              className="w-full text-left px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors flex items-center justify-between"
            >
              <span className="truncate">{tag.name}</span>
              {value.trim().toLowerCase() === tag.name.toLowerCase() && (
                <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          ))}

          {canCreate && (
            <button
              type="button"
              onClick={createNewTag}
              disabled={creating}
              className="w-full text-left px-4 py-2 text-sm text-white border-t border-zinc-800 hover:bg-zinc-800 transition-colors flex items-center gap-2"
              style={{ color: '#fa4d2e' }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              {creating ? 'Creating...' : <>Create tag <span className="font-semibold">&ldquo;{value.trim()}&rdquo;</span></>}
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mt-1.5 rounded border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5">
          <p className="text-[11px] text-amber-300 leading-snug">
            {error}
          </p>
          {errorCode === 'reconnect_required' && (
            <p className="text-[11px] text-amber-200/80 mt-1">
              Open{' '}
              <a
                href={`/dashboard/${workspaceId}/integrations`}
                className="underline hover:text-amber-100"
              >
                Integrations
              </a>{' '}
              and click Reconnect on GoHighLevel. You can still type a tag name by hand in the meantime.
            </p>
          )}
        </div>
      )}

      {!loading && !error && tags.length === 0 && (
        <p className="mt-1 text-[11px] text-zinc-500">
          No tags in this location yet. Type to create the first one.
        </p>
      )}
    </div>
  )
}
