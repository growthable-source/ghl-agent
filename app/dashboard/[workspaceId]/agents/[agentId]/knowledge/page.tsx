'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'

interface KnowledgeEntry {
  id: string
  title: string
  content: string
  source: string
  sourceUrl: string | null
  tokenEstimate: number
  status?: string
  createdAt?: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Decode HTML entities (&#8211; → –, &amp; → &, etc.) */
function decodeEntities(str: string): string {
  if (typeof document === 'undefined') return str
  const txt = document.createElement('textarea')
  txt.innerHTML = str
  return txt.value
}

/** Strip trailing "(N/M)" chunk suffix */
function stripChunkSuffix(title: string): string {
  return title.replace(/\s*\(\d+\/\d+\)\s*$/, '').trim()
}

/** Extract hostname from URL, stripping www. */
function hostFromUrl(url: string | null): string {
  if (!url) return ''
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch { return url }
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return n.toString()
}

// Groups of KnowledgeEntries that logically represent a single source
interface EntryGroup {
  key: string                    // stable group id for React
  displayTitle: string
  host: string | null            // for url/crawl groups
  source: string                 // most common source in the group
  sourceUrl: string | null
  entries: KnowledgeEntry[]      // 1+ entries
  totalTokens: number
  status: 'ready' | 'indexing' | 'failed' | 'mixed'
}

function groupEntries(entries: KnowledgeEntry[]): EntryGroup[] {
  // Group key: sourceUrl if present, else strip-chunk title
  const byKey = new Map<string, KnowledgeEntry[]>()
  for (const e of entries) {
    const key = e.sourceUrl || stripChunkSuffix(e.title)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(e)
  }

  const groups: EntryGroup[] = []
  for (const [key, list] of byKey) {
    // Pick a representative for title/source
    const rep = list[0]
    const cleanTitle = decodeEntities(stripChunkSuffix(rep.title))
    const totalTokens = list.reduce((s, e) => s + (e.tokenEstimate || 0), 0)
    const statuses = new Set(list.map(e => e.status || 'ready'))
    let status: EntryGroup['status'] = 'ready'
    if (statuses.has('failed')) status = 'failed'
    else if (statuses.has('indexing') || statuses.has('pending')) status = 'indexing'
    else if (statuses.size > 1) status = 'mixed'

    groups.push({
      key,
      displayTitle: cleanTitle,
      host: rep.sourceUrl ? hostFromUrl(rep.sourceUrl) : null,
      source: rep.source,
      sourceUrl: rep.sourceUrl,
      entries: list,
      totalTokens,
      status,
    })
  }

  // Newest first, roughly — use the max createdAt per group if present
  groups.sort((a, b) => {
    const aMax = Math.max(...a.entries.map(e => e.createdAt ? new Date(e.createdAt).getTime() : 0))
    const bMax = Math.max(...b.entries.map(e => e.createdAt ? new Date(e.createdAt).getTime() : 0))
    return bMax - aMax
  })

  return groups
}

interface CrawlSchedule {
  id: string
  url: string
  frequency: string
  isActive: boolean
  lastRunAt: string | null
  nextRunAt: string
  lastStatus: string | null
  newChunks: number
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function timeUntil(iso: string): string {
  const s = Math.floor((new Date(iso).getTime() - Date.now()) / 1000)
  if (s < 0) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `in ${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `in ${h}h`
  return `in ${Math.floor(h / 24)}d`
}

export default function KnowledgePage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [schedules, setSchedules] = useState<CrawlSchedule[]>([])
  const [tab, setTab] = useState<'manual' | 'url' | 'file' | 'scheduled'>('manual')

  // Manual
  const [kTitle, setKTitle] = useState('')
  const [kContent, setKContent] = useState('')
  const [addingK, setAddingK] = useState(false)

  // URL one-off
  const [crawlUrl, setCrawlUrl] = useState('')
  const [crawling, setCrawling] = useState(false)
  const [crawlResult, setCrawlResult] = useState('')

  // URL scheduled
  const [scheduleUrl, setScheduleUrl] = useState('')
  const [scheduleFrequency, setScheduleFrequency] = useState<'daily' | 'weekly' | 'monthly'>('weekly')
  const [addingSchedule, setAddingSchedule] = useState(false)

  // File
  const [uploadResult, setUploadResult] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  // Training-indicator IDs currently being processed client-side
  const [indexingIds, setIndexingIds] = useState<Set<string>>(new Set())

  // Which groups are currently expanded
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const fetchData = useCallback(async () => {
    const [agentRes, schedRes] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`).then(r => r.json()),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/crawl-schedules`).then(r => r.json()).catch(() => ({ schedules: [] })),
    ])
    setEntries(agentRes.agent?.knowledgeEntries ?? [])
    setSchedules(schedRes.schedules ?? [])
    setLoading(false)
  }, [workspaceId, agentId])

  useEffect(() => { fetchData() }, [fetchData])

  // Poll while any entries are indexing
  useEffect(() => {
    const hasIndexing = entries.some(e => e.status === 'indexing' || e.status === 'pending')
    if (!hasIndexing) return
    const i = setInterval(fetchData, 3000)
    return () => clearInterval(i)
  }, [entries, fetchData])

  async function addManual(e: React.FormEvent) {
    e.preventDefault()
    if (!kTitle.trim() || !kContent.trim()) return
    setAddingK(true)

    // Optimistic: show a temporary "indexing" entry immediately
    const tempId = `tmp-${Date.now()}`
    setEntries(prev => [...prev, {
      id: tempId,
      title: kTitle,
      content: kContent.slice(0, 200),
      source: 'manual',
      sourceUrl: null,
      tokenEstimate: Math.ceil(kContent.length / 4),
      status: 'indexing',
    }])
    setIndexingIds(prev => new Set(prev).add(tempId))

    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: kTitle, content: kContent }),
    })
    const { entry } = await res.json()
    setEntries(prev => prev.map(e => e.id === tempId ? { ...entry, status: 'ready' } : e))
    setIndexingIds(prev => { const n = new Set(prev); n.delete(tempId); return n })
    setKTitle('')
    setKContent('')
    setAddingK(false)
  }

  async function deleteEntry(id: string) {
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/knowledge/${id}`, { method: 'DELETE' })
    setEntries(prev => prev.filter(e => e.id !== id))
  }

  async function deleteGroup(group: EntryGroup) {
    const count = group.entries.length
    const label = count === 1 ? 'this entry' : `all ${count} chunks from "${group.displayTitle}"`
    if (!confirm(`Delete ${label}?`)) return
    // Optimistic remove
    const ids = new Set(group.entries.map(e => e.id))
    setEntries(prev => prev.filter(e => !ids.has(e.id)))
    // Fire deletes in parallel
    await Promise.all(group.entries.map(e =>
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/knowledge/${e.id}`, { method: 'DELETE' })
    ))
  }

  function toggleGroup(key: string) {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function doCrawl(e: React.FormEvent) {
    e.preventDefault()
    const normalized = normalizeUrl(crawlUrl)
    if (!normalized) return

    setCrawling(true)
    setCrawlResult('')
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/knowledge/crawl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalized }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCrawlResult(`✓ Added ${data.chunks} chunk${data.chunks !== 1 ? 's' : ''} from "${data.title}" (~${data.totalTokens} tokens)`)
      setCrawlUrl('')
      fetchData()
    } catch (err: any) {
      setCrawlResult(`Error: ${err.message}`)
    }
    setCrawling(false)
  }

  async function addSchedule(e: React.FormEvent) {
    e.preventDefault()
    const normalized = normalizeUrl(scheduleUrl)
    if (!normalized) return
    setAddingSchedule(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/crawl-schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalized, frequency: scheduleFrequency }),
      })
      if (res.ok) {
        setScheduleUrl('')
        fetchData()
      }
    } finally { setAddingSchedule(false) }
  }

  async function toggleSchedule(id: string, current: boolean) {
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/crawl-schedules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !current }),
    })
    fetchData()
  }

  async function runScheduleNow(id: string) {
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/crawl-schedules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'run_now' }),
    })
    fetchData()
  }

  async function deleteSchedule(id: string) {
    if (!confirm('Remove this recurring crawl?')) return
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/crawl-schedules/${id}`, {
      method: 'DELETE',
    })
    setSchedules(prev => prev.filter(s => s.id !== id))
  }

  async function uploadFile(file: File) {
    setUploading(true)
    setUploadResult('')
    setDragOver(false)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/knowledge/upload`, {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setUploadResult(`✓ Added ${data.chunks} chunk${data.chunks !== 1 ? 's' : ''} from "${data.fileName}" (~${data.totalTokens} tokens)`)
      fetchData()
    } catch (err: any) {
      setUploadResult(`Error: ${err.message}`)
    }
    setUploading(false)
  }

  // Hooks must be called on every render in the same order. `useMemo` used
  // to live below the `if (loading) return …` early-return — so on the first
  // render React saw N hooks, and on the second render it saw N+1, crashing
  // with React #310 ("Rendered more hooks than during the previous render").
  // Keep it above any conditional return.
  const groups = useMemo(() => groupEntries(entries), [entries])

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  const totalTokens = entries.reduce((s, e) => s + (e.tokenEstimate || 0), 0)
  const indexingCount = entries.filter(e => e.status === 'indexing' || e.status === 'pending').length

  return (
    <div className="p-8 max-w-2xl space-y-6">
      {entries.length > 0 && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>{groups.length} source{groups.length === 1 ? '' : 's'} · {entries.length} chunk{entries.length === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-2">
            {indexingCount > 0 && (
              <span className="flex items-center gap-1 text-amber-400">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                {indexingCount} indexing
              </span>
            )}
            <span>~{totalTokens.toLocaleString()} tokens{entries.length > 15 && <span className="ml-1 text-emerald-500">· smart retrieval on</span>}</span>
          </div>
        </div>
      )}

      {groups.length > 0 && (
        <div className="rounded-lg border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
          {groups.map(group => {
            const isExpanded = expandedGroups.has(group.key)
            const chunkCount = group.entries.length
            const sourceIcon = group.source === 'url' ? '↗'
              : group.source === 'file' ? '◻'
              : group.source === 'correction' ? '✎'
              : group.source === 'crawl' ? '🔄'
              : '✎'
            const sourceColor = group.source === 'url' ? 'text-blue-400'
              : group.source === 'file' ? 'text-purple-400'
              : group.source === 'correction' ? 'text-emerald-400'
              : group.source === 'crawl' ? 'text-cyan-400'
              : 'text-zinc-500'
            const statusDot = group.status === 'indexing'
              ? <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" title="Indexing" />
              : group.status === 'failed'
              ? <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" title="Failed" />
              : <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" title="Ready" />

            return (
              <div key={group.key}>
                {/* ─── Collapsed row ─────────────────────────────────── */}
                <div
                  className="group flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-900/40 transition-colors cursor-pointer"
                  onClick={() => toggleGroup(group.key)}
                >
                  {/* Expand chevron */}
                  <svg
                    className={`w-3 h-3 text-zinc-600 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>

                  {/* Source icon */}
                  <span className={`text-sm ${sourceColor} flex-shrink-0`}>{sourceIcon}</span>

                  {/* Status dot */}
                  {statusDot}

                  {/* Title + meta */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-zinc-200 truncate font-medium">{group.displayTitle}</p>
                    <p className="text-[11px] text-zinc-500 truncate">
                      {group.host && <span>{group.host}</span>}
                      {group.host && ' · '}
                      {chunkCount === 1
                        ? `~${formatTokens(group.totalTokens)} tokens`
                        : `${chunkCount} chunks · ~${formatTokens(group.totalTokens)} tokens`}
                    </p>
                  </div>

                  {/* Delete group */}
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteGroup(group) }}
                    className="opacity-0 group-hover:opacity-100 text-xs text-zinc-600 hover:text-red-400 transition-all px-2 py-1 rounded flex-shrink-0"
                    title={chunkCount === 1 ? 'Delete entry' : `Delete all ${chunkCount} chunks`}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9M6.772 5.79l1.068 13.883A2.25 2.25 0 0010.084 21.75h3.832a2.25 2.25 0 002.244-2.077L17.228 5.79M9.75 4.75A1.75 1.75 0 0111.5 3h1a1.75 1.75 0 011.75 1.75V5.79H9.75V4.75z" />
                    </svg>
                  </button>
                </div>

                {/* ─── Expanded chunks ────────────────────────────────── */}
                {isExpanded && (
                  <div className="bg-zinc-950/40 border-t border-zinc-800">
                    {/* Source link */}
                    {group.sourceUrl && (
                      <div className="px-4 py-2 border-b border-zinc-800">
                        <a href={group.sourceUrl} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-500 hover:text-blue-400 break-all">
                          {group.sourceUrl}
                        </a>
                      </div>
                    )}

                    {/* Individual chunks */}
                    <div className="divide-y divide-zinc-800/50">
                      {group.entries.map((entry, i) => {
                        const isIndexing = entry.status === 'indexing' || entry.status === 'pending'
                        const isFailed = entry.status === 'failed'
                        return (
                          <div key={entry.id} className="px-4 py-2.5 flex items-start gap-3 group/chunk hover:bg-zinc-900/30">
                            <span className="text-[10px] text-zinc-600 font-mono pt-0.5 w-6 flex-shrink-0">
                              {group.entries.length > 1 ? `${i + 1}` : ''}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-zinc-400 line-clamp-2">{entry.content}</p>
                              <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-600">
                                <span>~{formatTokens(entry.tokenEstimate || 0)} tokens</span>
                                {isIndexing && (
                                  <span className="flex items-center gap-1 text-amber-400">
                                    <span className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
                                    Indexing
                                  </span>
                                )}
                                {isFailed && <span className="text-red-400">Failed</span>}
                              </div>
                            </div>
                            <button
                              onClick={() => deleteEntry(entry.id)}
                              disabled={isIndexing}
                              className="opacity-0 group-hover/chunk:opacity-100 text-[10px] text-zinc-600 hover:text-red-400 transition-all flex-shrink-0 disabled:opacity-20"
                              title="Delete this chunk"
                            >
                              Delete
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <div className="flex border-b border-zinc-800">
          {(['manual', 'url', 'file', 'scheduled'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
                tab === t ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t === 'manual' ? '✎ Write'
                : t === 'url' ? '↗ URL'
                : t === 'file' ? '◻ File'
                : '🔄 Auto-crawl'}
            </button>
          ))}
        </div>
        <div className="p-4">
          {tab === 'manual' && (
            <form onSubmit={addManual} className="space-y-3">
              <input
                type="text"
                value={kTitle}
                onChange={e => setKTitle(e.target.value)}
                placeholder="Title (e.g. Pricing, FAQ)"
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
              <textarea
                value={kContent}
                onChange={e => setKContent(e.target.value)}
                placeholder="Paste content here…"
                required
                rows={5}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-y"
              />
              <button
                type="submit"
                disabled={addingK}
                className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                {addingK ? 'Indexing…' : 'Add Entry'}
              </button>
            </form>
          )}

          {tab === 'url' && (
            <form onSubmit={doCrawl} className="space-y-3">
              <div className="flex items-stretch rounded-lg border border-zinc-700 overflow-hidden focus-within:border-zinc-500 transition-colors bg-zinc-900">
                <span className="pl-3 pr-2 flex items-center text-xs text-zinc-500 border-r border-zinc-800 select-none">
                  https://
                </span>
                <input
                  type="text"
                  value={crawlUrl.replace(/^https?:\/\//i, '')}
                  onChange={e => setCrawlUrl(e.target.value)}
                  placeholder="growthable.io/pricing"
                  required
                  className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none"
                />
              </div>
              <p className="text-xs text-zinc-600">Page content will be fetched, cleaned, and chunked automatically.</p>
              {crawlResult && (
                <p className={`text-xs ${crawlResult.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>{crawlResult}</p>
              )}
              <button
                type="submit"
                disabled={crawling}
                className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                {crawling ? (
                  <>
                    <span className="w-3 h-3 mr-2 border-2 border-black/40 border-t-black rounded-full animate-spin" />
                    Indexing…
                  </>
                ) : 'Crawl Page'}
              </button>
            </form>
          )}

          {tab === 'file' && (
            <div className="space-y-3">
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragOver ? 'border-zinc-500 bg-zinc-800/50' : 'border-zinc-700'
                }`}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) uploadFile(f) }}
              >
                <p className="text-sm text-zinc-400 mb-2">Drop a file here or</p>
                <label className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors cursor-pointer">
                  Browse
                  <input type="file" accept=".pdf,.txt,.md" className="hidden"
                    onChange={e => e.target.files?.[0] && uploadFile(e.target.files[0])} />
                </label>
                <p className="text-xs text-zinc-600 mt-2">PDF, TXT, MD — max 5MB</p>
              </div>
              {uploadResult && (
                <p className={`text-xs ${uploadResult.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>{uploadResult}</p>
              )}
              {uploading && (
                <p className="text-xs text-amber-400 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Uploading and indexing…
                </p>
              )}
            </div>
          )}

          {tab === 'scheduled' && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-zinc-300 mb-1 font-medium">Auto-crawl URLs on a schedule</p>
                <p className="text-xs text-zinc-500">
                  New content is detected and indexed automatically. Unchanged pages are skipped.
                </p>
              </div>

              {/* Existing schedules */}
              {schedules.length > 0 && (
                <div className="space-y-2">
                  {schedules.map(s => (
                    <div key={s.id} className="p-3 rounded-lg border border-zinc-800 bg-zinc-900/40">
                      <div className="flex items-start gap-2">
                        <button
                          onClick={() => toggleSchedule(s.id, s.isActive)}
                          className="mt-0.5 relative inline-flex h-4 w-8 items-center rounded-full flex-shrink-0"
                          style={{ background: s.isActive ? '#22c55e' : '#3f3f46' }}
                        >
                          <span className="inline-block h-2.5 w-2.5 rounded-full bg-white transition-transform"
                            style={{ transform: s.isActive ? 'translateX(18px)' : 'translateX(3px)' }} />
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-mono text-white truncate">{s.url}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-[10px] text-zinc-500">Every {s.frequency.replace('ly', '')}</span>
                            <span className="text-[10px] text-zinc-600">·</span>
                            <span className="text-[10px] text-zinc-500">
                              Next {s.isActive ? timeUntil(s.nextRunAt) : 'paused'}
                            </span>
                            {s.lastRunAt && (
                              <>
                                <span className="text-[10px] text-zinc-600">·</span>
                                <span className={`text-[10px] ${
                                  s.lastStatus === 'success' ? 'text-emerald-400'
                                  : s.lastStatus === 'failed' ? 'text-red-400'
                                  : 'text-zinc-500'
                                }`}>
                                  Last {timeAgo(s.lastRunAt)}
                                  {s.newChunks > 0 && ` · +${s.newChunks} chunks total`}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => runScheduleNow(s.id)}
                          className="text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors"
                          title="Run this crawl now"
                        >
                          Run now
                        </button>
                        <button
                          onClick={() => deleteSchedule(s.id)}
                          className="text-zinc-500 hover:text-red-400 p-1"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add new schedule */}
              <form onSubmit={addSchedule} className="space-y-3 pt-3 border-t border-zinc-800">
                <div className="flex items-stretch rounded-lg border border-zinc-700 overflow-hidden focus-within:border-zinc-500 transition-colors bg-zinc-900">
                  <span className="pl-3 pr-2 flex items-center text-xs text-zinc-500 border-r border-zinc-800 select-none">
                    https://
                  </span>
                  <input
                    type="text"
                    value={scheduleUrl.replace(/^https?:\/\//i, '')}
                    onChange={e => setScheduleUrl(e.target.value)}
                    placeholder="growthable.io/changelog"
                    required
                    className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none"
                  />
                </div>
                <div className="flex gap-2">
                  <select
                    value={scheduleFrequency}
                    onChange={e => setScheduleFrequency(e.target.value as any)}
                    className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
                  >
                    <option value="daily">Every day</option>
                    <option value="weekly">Every week</option>
                    <option value="monthly">Every month</option>
                  </select>
                  <button
                    type="submit"
                    disabled={addingSchedule || !scheduleUrl.trim()}
                    className="flex-1 inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm px-4 hover:bg-zinc-200 transition-colors disabled:opacity-50"
                  >
                    {addingSchedule ? 'Adding…' : '+ Add recurring crawl'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
