'use client'

import { useEffect, useState, useCallback } from 'react'
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
          <span>{entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</span>
          <div className="flex items-center gap-2">
            {indexingCount > 0 && (
              <span className="flex items-center gap-1 text-amber-400">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                {indexingCount} indexing
              </span>
            )}
            <span>~{totalTokens.toLocaleString()} tokens{entries.length > 15 && <span className="ml-1 text-emerald-500">(smart retrieval active)</span>}</span>
          </div>
        </div>
      )}

      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map(entry => {
            const isIndexing = entry.status === 'indexing' || entry.status === 'pending'
            const isFailed = entry.status === 'failed'
            return (
              <div key={entry.id} className={`rounded-lg border px-4 py-3 transition-colors ${
                isIndexing ? 'border-amber-500/40 bg-amber-500/5'
                : isFailed ? 'border-red-500/40 bg-red-500/5'
                : 'border-zinc-800'
              }`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <p className="text-sm font-medium text-zinc-200">{entry.title}</p>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        entry.source === 'url' ? 'bg-blue-900/40 text-blue-400' :
                        entry.source === 'file' ? 'bg-purple-900/40 text-purple-400' :
                        entry.source === 'correction' ? 'bg-emerald-900/40 text-emerald-400' :
                        entry.source === 'crawl' ? 'bg-cyan-900/40 text-cyan-400' :
                        'bg-zinc-800 text-zinc-500'
                      }`}>
                        {entry.source === 'url' ? '↗ url'
                          : entry.source === 'file' ? '◻ file'
                          : entry.source === 'correction' ? '✎ correction'
                          : entry.source === 'crawl' ? '🔄 auto-crawl'
                          : '✎ manual'}
                      </span>
                      {isIndexing && (
                        <span className="flex items-center gap-1 text-[11px] text-amber-400 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                          Indexing...
                        </span>
                      )}
                      {isFailed && (
                        <span className="text-[11px] text-red-400 font-medium">Failed</span>
                      )}
                      {entry.status === 'ready' && !isIndexing && !isFailed && (
                        <span className="text-[11px] text-emerald-500 font-medium">● ready</span>
                      )}
                      {(entry.tokenEstimate || 0) > 0 && (
                        <span className="text-xs text-zinc-600">~{entry.tokenEstimate} tokens</span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 line-clamp-2">{entry.content}</p>
                    {entry.sourceUrl && (
                      <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:text-blue-400 truncate block mt-1">
                        {entry.sourceUrl}
                      </a>
                    )}
                  </div>
                  <button
                    onClick={() => deleteEntry(entry.id)}
                    disabled={isIndexing}
                    className="text-xs text-zinc-600 hover:text-red-400 transition-colors shrink-0 disabled:opacity-30"
                  >
                    Delete
                  </button>
                </div>
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
