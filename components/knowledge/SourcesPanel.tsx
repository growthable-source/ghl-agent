'use client'

/**
 * The "teach your AI anything" panel — the simple face of the
 * knowledge pipeline.
 *
 * One input: paste ANY link (website, help center, sitemap, YouTube
 * video/channel, RSS feed) or drop a file (PDF/TXT/MD, up to 20 MB).
 * The server auto-detects the type, queues background ingestion, and
 * this panel polls the source list so the user watches it learn —
 * no "domains", no "chunks", no source-type picker.
 *
 * Every URL source auto-checks for changes on a plain-language
 * cadence (daily for feeds, weekly for sites) the user can change
 * per row.
 *
 * Sources belong to a COLLECTION, the same container that holds
 * written items:
 *   - `collectionId` set    → adds to and lists only that collection
 *                             (the collection detail page's Sources tab)
 *   - `collectionId` unset  → adds to the workspace's default collection
 *   - `showList={false}`    → just the add box, for the Knowledge index
 *                             where the collection cards are the list
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface SourceRow {
  id: string
  sourceType: string
  url: string
  displayName: string
  isActive: boolean
  recrawlIntervalDays: number
  lastCrawledAt: string | null
  chunkCount: number
  latestRun: {
    id: string
    status: string
    pagesAttempted: number | null
    pagesSucceeded: number | null
    chunksCreated: number | null
    errorCount: number
    completedAt: string | null
    firstError: string | null
  } | null
}

const TYPE_META: Record<string, { icon: string; noun: string }> = {
  docs: { icon: '🌐', noun: 'Website' },
  rss: { icon: '📰', noun: 'Feed' },
  youtube: { icon: '▶️', noun: 'YouTube' },
  pdf: { icon: '📄', noun: 'File' },
}

const CADENCES = [
  { days: 1, label: 'Checks daily' },
  { days: 7, label: 'Checks weekly' },
  { days: 30, label: 'Checks monthly' },
  { days: 0, label: 'Never re-checks' },
]

function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function statusOf(s: SourceRow): { label: string; tone: 'busy' | 'ok' | 'warn' | 'muted' } {
  if (!s.isActive) return { label: 'Paused', tone: 'muted' }
  const run = s.latestRun
  if (!run || run.status === 'queued') return { label: 'Waiting to start…', tone: 'busy' }
  if (run.status === 'running') {
    const progress =
      run.pagesAttempted && run.pagesAttempted > 0 ? ` ${run.pagesSucceeded ?? 0}/${run.pagesAttempted}` : ''
    return { label: `Learning…${progress}`, tone: 'busy' }
  }
  if (run.status === 'failed') return { label: 'Couldn’t read this — retry', tone: 'warn' }
  if (run.status === 'partial') return { label: `Mostly read (${run.errorCount} pages failed) — retry`, tone: 'warn' }
  return {
    label: s.lastCrawledAt ? `Up to date · checked ${relTime(s.lastCrawledAt)}` : 'Up to date',
    tone: 'ok',
  }
}

export default function SourcesPanel({
  workspaceId,
  collectionId,
  showList = true,
  onChanged,
}: {
  workspaceId: string
  collectionId?: string | null
  showList?: boolean
  /** Fired after any add/delete so a parent page can refresh its counts. */
  onChanged?: () => void
}) {
  const [sources, setSources] = useState<SourceRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const qs = collectionId ? `?collectionId=${encodeURIComponent(collectionId)}` : ''
      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/sources${qs}`)
      const body = await res.json().catch(() => ({}))
      if (Array.isArray(body.sources)) setSources(body.sources)
    } finally {
      setLoaded(true)
    }
  }, [workspaceId, collectionId])

  useEffect(() => {
    void load()
  }, [load])

  // Poll faster while anything is in flight; trickle otherwise so
  // "checked 2h ago" stays roughly honest without a refresh.
  const anyBusy = sources.some(
    s => s.isActive && (!s.latestRun || ['queued', 'running'].includes(s.latestRun.status)),
  )
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(() => void load(), anyBusy ? 3500 : 60000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [anyBusy, load])

  const showFlash = (kind: 'ok' | 'err', text: string) => {
    setFlash({ kind, text })
    setTimeout(() => setFlash(null), 5000)
  }

  const addUrl = useCallback(async () => {
    const url = input.trim()
    if (!url) return
    setAdding(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, collectionId: collectionId ?? undefined }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        showFlash('err', body.error || 'Couldn’t add that link.')
        return
      }
      setInput('')
      onChanged?.()
      showFlash(
        'ok',
        body.alreadyExisted
          ? `Already learning that ${body.label} — re-checking it now.`
          : `Got it — learning this ${body.label} in the background.`,
      )
      void load()
    } finally {
      setAdding(false)
    }
  }, [input, workspaceId, collectionId, load, onChanged])

  const addFile = useCallback(
    async (file: File) => {
      setAdding(true)
      try {
        const form = new FormData()
        form.append('file', file)
        if (collectionId) form.append('collectionId', collectionId)
        const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/add`, {
          method: 'POST',
          body: form,
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          showFlash('err', body.error || 'Upload failed.')
          return
        }
        showFlash('ok', `Got it — reading ${file.name} in the background.`)
        onChanged?.()
        void load()
      } finally {
        setAdding(false)
      }
    },
    [workspaceId, collectionId, load, onChanged],
  )

  const act = useCallback(
    async (sourceId: string, payload: Record<string, unknown>) => {
      await fetch(`/api/workspaces/${workspaceId}/knowledge/sources/${sourceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      void load()
    },
    [workspaceId, load],
  )

  const remove = useCallback(
    async (sourceId: string, name: string) => {
      if (!confirm(`Forget everything learned from “${name}”?`)) return
      await fetch(`/api/workspaces/${workspaceId}/knowledge/sources/${sourceId}`, { method: 'DELETE' })
      onChanged?.()
      void load()
    },
    [workspaceId, load, onChanged],
  )

  return (
    <div className="mb-8">
      {/* ── The magic box ─────────────────────────────────────────── */}
      <div
        className={`rounded-xl border-2 border-dashed p-5 transition-colors ${
          dragOver ? 'border-zinc-500' : 'border-zinc-800'
        }`}
        style={{ background: 'var(--surface-secondary)' }}
        onDragOver={e => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault()
          setDragOver(false)
          const file = e.dataTransfer.files?.[0]
          if (file) void addFile(file)
        }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void addUrl()
            }}
            placeholder="Paste any link — a website, help center, YouTube video or channel, or RSS feed…"
            className="flex-1 min-w-[260px] bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
          />
          <button
            onClick={() => void addUrl()}
            disabled={adding || !input.trim()}
            className="px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40"
            style={{ background: 'var(--accent-primary)', color: '#fff' }}
          >
            {adding ? 'Adding…' : 'Teach it'}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={adding}
            className="px-4 py-2.5 rounded-lg text-sm font-medium border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
          >
            Upload file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md,.markdown"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) void addFile(file)
              e.target.value = ''
            }}
          />
        </div>
        <p className="text-xs text-zinc-500 mt-2">
          Or drop a PDF / text file anywhere in this box (up to 20 MB). Everything is read in the
          background, your agents know it automatically, and links are re-checked for changes on a
          schedule you control.
        </p>
        {flash && (
          <p
            className="text-xs mt-2 font-medium"
            style={{ color: flash.kind === 'ok' ? 'var(--accent-emerald)' : 'var(--accent-red)' }}
          >
            {flash.text}
          </p>
        )}
      </div>

      {/* ── What it's learning from ───────────────────────────────── */}
      {showList && loaded && sources.length > 0 && (
        <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900 divide-y divide-zinc-800 overflow-hidden">
          {sources.map(s => {
            const meta = TYPE_META[s.sourceType] ?? { icon: '📚', noun: 'Source' }
            const status = statusOf(s)
            return (
              <div key={s.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                <span className="shrink-0 text-base" title={meta.noun}>
                  {meta.icon}
                </span>
                <div className="flex-1 min-w-[220px]">
                  <p className="text-sm text-zinc-100 truncate" title={s.url}>
                    {s.displayName}
                  </p>
                  <p className="text-xs flex items-center gap-1.5 flex-wrap">
                    {status.tone === 'busy' && (
                      <span className="inline-block w-3 h-3 border-[1.5px] border-zinc-500 border-t-transparent rounded-full animate-spin" />
                    )}
                    {status.tone === 'warn' ? (
                      // Failure label IS the retry button — the copy
                      // promises it, the handler delivers it.
                      <button
                        onClick={() => void act(s.id, { action: 'recheck' })}
                        className="font-medium underline decoration-dotted underline-offset-2 hover:opacity-80 transition-opacity"
                        style={{ color: 'var(--accent-amber)' }}
                      >
                        {status.label}
                      </button>
                    ) : (
                      <span
                        style={{
                          color: status.tone === 'ok' ? 'var(--accent-emerald)' : 'var(--text-tertiary)',
                        }}
                      >
                        {status.label}
                      </span>
                    )}
                    {s.chunkCount > 0 && (
                      <span className="text-zinc-500">· {s.chunkCount} snippets learned</span>
                    )}
                  </p>
                  {status.tone === 'warn' && s.latestRun?.firstError && (
                    <p className="text-[11px] text-zinc-500 mt-0.5 truncate" title={s.latestRun.firstError}>
                      {s.latestRun.firstError}
                    </p>
                  )}
                </div>

                {s.sourceType !== 'pdf' && (
                  <select
                    value={String(s.recrawlIntervalDays)}
                    onChange={e => void act(s.id, { recrawlIntervalDays: Number(e.target.value) })}
                    className="shrink-0 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-400 focus:outline-none"
                  >
                    {CADENCES.map(c => (
                      <option key={c.days} value={c.days}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                )}

                <div className="shrink-0 flex items-center gap-1">
                  <button
                    onClick={() => void act(s.id, { action: 'recheck' })}
                    title="Check for changes now"
                    className="px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800 transition-colors"
                  >
                    Re-check
                  </button>
                  <button
                    onClick={() => void act(s.id, { action: s.isActive ? 'pause' : 'resume' })}
                    className="px-2.5 py-1.5 rounded-lg text-xs text-zinc-400 hover:bg-zinc-800 transition-colors"
                  >
                    {s.isActive ? 'Pause' : 'Resume'}
                  </button>
                  <button
                    onClick={() => void remove(s.id, s.displayName)}
                    title="Forget this source"
                    className="px-2.5 py-1.5 rounded-lg text-xs hover:bg-zinc-800 transition-colors"
                    style={{ color: 'var(--accent-red)' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
