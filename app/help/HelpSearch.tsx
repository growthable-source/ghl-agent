'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Result {
  id: string
  slug: string
  title: string
  summary: string | null
  category?: { name: string } | null
}

/**
 * Fast autocomplete search. Debounced to /api/help/search and rendered as
 * a dropdown under the input. Enter submits to /help/search for the full
 * results view.
 */
export default function HelpSearch({ initial = '' }: { initial?: string }) {
  const [q, setQ] = useState(initial)
  const [results, setResults] = useState<Result[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    const id = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/help/search?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        setResults(data.results || [])
        setOpen(true)
      } finally { setLoading(false) }
    }, 180)
    return () => clearTimeout(id)
  }, [q])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (q.trim()) router.push(`/help/search?q=${encodeURIComponent(q)}`)
  }

  return (
    <div ref={wrapRef} className="relative">
      <form onSubmit={submit}>
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          onFocus={() => q.trim() && setOpen(true)}
          placeholder="Search help articles…"
          className="w-full bg-zinc-900 border border-zinc-700 hover:border-zinc-600 focus:border-zinc-500 rounded-xl px-5 py-3.5 text-base text-white placeholder-zinc-500 focus:outline-none transition-colors"
        />
      </form>

      {open && q.trim() && (
        <div className="absolute top-full left-0 right-0 mt-2 z-30 rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">
          {loading && (
            <div className="px-5 py-3 text-xs text-zinc-500">Searching…</div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-5 py-3 text-xs text-zinc-500">No results for &ldquo;{q}&rdquo;</div>
          )}
          {results.slice(0, 8).map(r => (
            <Link
              key={r.id}
              href={`/help/a/${r.slug}`}
              onClick={() => setOpen(false)}
              className="block px-5 py-3 hover:bg-zinc-900 border-b border-zinc-900 last:border-b-0 transition-colors"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-100 truncate">{r.title}</div>
                  {r.summary && <div className="text-xs text-zinc-500 truncate mt-0.5">{r.summary}</div>}
                </div>
                {r.category && (
                  <span className="text-[10px] text-zinc-500 bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 shrink-0">
                    {r.category.name}
                  </span>
                )}
              </div>
            </Link>
          ))}
          {results.length > 0 && (
            <div className="px-5 py-2 border-t border-zinc-900 bg-zinc-900/40 text-center">
              <button
                type="button"
                onClick={() => router.push(`/help/search?q=${encodeURIComponent(q)}`)}
                className="text-[11px] text-blue-400 hover:text-blue-300 transition-colors"
              >
                See all results →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
