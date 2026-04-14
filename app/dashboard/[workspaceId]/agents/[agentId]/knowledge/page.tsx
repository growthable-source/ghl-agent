'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface KnowledgeEntry {
  id: string
  title: string
  content: string
  source: string
  sourceUrl: string | null
  tokenEstimate: number
}

export default function KnowledgePage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [loading, setLoading] = useState(true)
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [tab, setTab] = useState<'manual' | 'url' | 'file'>('manual')

  // Manual
  const [kTitle, setKTitle] = useState('')
  const [kContent, setKContent] = useState('')
  const [addingK, setAddingK] = useState(false)

  // URL
  const [crawlUrl, setCrawlUrl] = useState('')
  const [crawling, setCrawling] = useState(false)
  const [crawlResult, setCrawlResult] = useState('')

  // File
  const [uploadResult, setUploadResult] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      .then(r => r.json())
      .then(({ agent }) => setEntries(agent.knowledgeEntries ?? []))
      .finally(() => setLoading(false))
  }, [workspaceId, agentId])

  async function addManual(e: React.FormEvent) {
    e.preventDefault()
    if (!kTitle.trim() || !kContent.trim()) return
    setAddingK(true)
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: kTitle, content: kContent }),
    })
    const { entry } = await res.json()
    setEntries(prev => [...prev, entry])
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
    setCrawling(true)
    setCrawlResult('')
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/knowledge/crawl`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: crawlUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCrawlResult(`✓ Added ${data.chunks} chunk${data.chunks !== 1 ? 's' : ''} from "${data.title}" (~${data.totalTokens} tokens)`)
      setCrawlUrl('')
      const r2 = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      const { agent } = await r2.json()
      setEntries(agent.knowledgeEntries ?? [])
    } catch (err: any) {
      setCrawlResult(`Error: ${err.message}`)
    }
    setCrawling(false)
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
      const r2 = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      const { agent } = await r2.json()
      setEntries(agent.knowledgeEntries ?? [])
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

  return (
    <div className="p-8 max-w-2xl space-y-6">
      {entries.length > 0 && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>{entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</span>
          <span>~{totalTokens.toLocaleString()} tokens{entries.length > 15 && <span className="ml-1 text-emerald-500">(smart retrieval active)</span>}</span>
        </div>
      )}

      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map(entry => (
            <div key={entry.id} className="rounded-lg border border-zinc-800 px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <p className="text-sm font-medium text-zinc-200">{entry.title}</p>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      entry.source === 'url' ? 'bg-blue-900/40 text-blue-400' :
                      entry.source === 'file' ? 'bg-purple-900/40 text-purple-400' :
                      'bg-zinc-800 text-zinc-500'
                    }`}>
                      {entry.source === 'url' ? '↗ url' : entry.source === 'file' ? '◻ file' : '✎ manual'}
                    </span>
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
                  className="text-xs text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 overflow-hidden">
        <div className="flex border-b border-zinc-800">
          {(['manual', 'url', 'file'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
                tab === t ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {t === 'manual' ? '✎ Write' : t === 'url' ? '↗ URL' : '◻ File'}
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
                {addingK ? 'Adding…' : 'Add Entry'}
              </button>
            </form>
          )}
          {tab === 'url' && (
            <form onSubmit={doCrawl} className="space-y-3">
              <input
                type="url"
                value={crawlUrl}
                onChange={e => setCrawlUrl(e.target.value)}
                placeholder="https://example.com/page"
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
              <p className="text-xs text-zinc-600">Page content will be fetched, cleaned, and chunked automatically.</p>
              {crawlResult && (
                <p className={`text-xs ${crawlResult.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>{crawlResult}</p>
              )}
              <button
                type="submit"
                disabled={crawling}
                className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                {crawling ? 'Fetching…' : 'Crawl Page'}
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
              {uploading && <p className="text-xs text-zinc-500">Uploading and processing…</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
