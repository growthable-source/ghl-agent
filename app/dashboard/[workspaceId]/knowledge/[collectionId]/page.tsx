'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface Entry {
  id: string
  title: string
  content: string
  source: string
  sourceUrl: string | null
  tokenEstimate: number
  status: string
  createdAt: string
}

interface DataSource {
  id: string
  name: string
  kind: 'google_sheet' | 'airtable' | 'rest_get'
  description: string | null
  isActive: boolean
  config: Record<string, any>
}

interface ConnectedAgent { id: string; name: string }

interface Collection {
  id: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  order: number
  createdAt: string
  updatedAt: string
  entries: Entry[]
  dataSources: DataSource[]
  connectedAgents: ConnectedAgent[]
}

interface AgentLite { id: string; name: string }

type Tab = 'items' | 'data_sources' | 'agents'
type AddItem = 'manual' | 'qa' | 'url' | 'file' | 'notion' | 'youtube' | null

function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'manual':     return 'Written'
    case 'qa':         return 'Q&A'
    case 'notion':     return 'Notion'
    case 'youtube':    return 'YouTube'
    case 'url':        return 'Web'
    case 'file':       return 'File'
    case 'correction': return 'Correction'
    default:           return source
  }
}

export default function CollectionEditorPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const collectionId = params.collectionId as string

  const [collection, setCollection] = useState<Collection | null>(null)
  const [agents, setAgents] = useState<AgentLite[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('items')
  const [addItem, setAddItem] = useState<AddItem>(null)

  const fetchAll = useCallback(async () => {
    const [cRes, aRes] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/knowledge/collections/${collectionId}`),
      fetch(`/api/workspaces/${workspaceId}/agents`),
    ])
    const cData = await cRes.json()
    const aData = await aRes.json()
    if (cData.collection) setCollection(cData.collection)
    setAgents((aData.agents || []).map((a: any) => ({ id: a.id, name: a.name })))
    setLoading(false)
  }, [workspaceId, collectionId])

  useEffect(() => { fetchAll() }, [fetchAll])

  async function deleteEntry(entryId: string) {
    if (!confirm('Delete this item from the collection?')) return
    await fetch(`/api/workspaces/${workspaceId}/knowledge/collections/${collectionId}/entries/${entryId}`, { method: 'DELETE' })
    fetchAll()
  }

  async function deleteCollection() {
    if (!confirm('Delete this entire collection? Every connected agent will lose access to its items.')) return
    await fetch(`/api/workspaces/${workspaceId}/knowledge/collections/${collectionId}`, { method: 'DELETE' })
    router.push(`/dashboard/${workspaceId}/knowledge`)
  }

  if (loading) return (
    <div className="flex-1 p-8">
      <div className="max-w-4xl mx-auto space-y-3">
        <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" />
        <div className="h-32 bg-zinc-900/40 rounded-xl border border-zinc-800 animate-pulse" />
      </div>
    </div>
  )
  if (!collection) return <div className="p-8 text-zinc-500">Collection not found</div>

  const accent = collection.color || '#fa4d2e'
  const totalTokens = collection.entries.reduce((s, e) => s + (e.tokenEstimate || 0), 0)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto p-8">
        <Link href={`/dashboard/${workspaceId}/knowledge`} className="text-xs text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1 mb-4">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          All collections
        </Link>

        <div className="flex items-start gap-4 mb-6">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
            style={{ background: `linear-gradient(135deg, ${accent}33, ${accent}11)` }}
          >
            {collection.icon || '📚'}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-white">{collection.name}</h1>
            {collection.description && (
              <p className="text-sm text-zinc-400 mt-1">{collection.description}</p>
            )}
            <p className="text-[11px] text-zinc-500 mt-2">
              {collection.entries.length} item{collection.entries.length === 1 ? '' : 's'}
              {totalTokens > 0 && <> · ~{totalTokens.toLocaleString()} tokens</>}
              {collection.dataSources.length > 0 && <> · {collection.dataSources.length} data source{collection.dataSources.length === 1 ? '' : 's'}</>}
              {' · '}
              connected to {collection.connectedAgents.length} agent{collection.connectedAgents.length === 1 ? '' : 's'}
            </p>
          </div>
          <button
            onClick={deleteCollection}
            className="text-[11px] px-3 py-1.5 rounded-lg border border-zinc-800 text-red-400 hover:text-red-300 hover:border-red-500/40 transition-colors"
          >
            Delete collection
          </button>
        </div>

        <div className="flex items-center gap-2 mb-4 border-b border-zinc-800">
          {([
            { id: 'items',        label: `Items (${collection.entries.length})` },
            { id: 'data_sources', label: `Data sources (${collection.dataSources.length})` },
            { id: 'agents',       label: `Connected agents (${collection.connectedAgents.length})` },
          ] as Array<{ id: Tab; label: string }>).map(t => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`text-xs font-medium px-3 py-2 border-b-2 -mb-px transition-colors ${
                  active ? 'border-orange-500 text-white' : 'border-transparent text-zinc-500 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {tab === 'items' && (
          <div>
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              {([
                { id: 'manual',  label: '✎ Write' },
                { id: 'url',     label: '🔗 Crawl URL' },
                { id: 'file',    label: '📎 Upload file' },
                { id: 'qa',      label: '❓ Q&A pairs' },
                { id: 'notion',  label: '◫ Notion page' },
                { id: 'youtube', label: '▶ YouTube' },
              ] as Array<{ id: Exclude<AddItem, null>; label: string }>).map(t => (
                <button
                  key={t.id}
                  onClick={() => setAddItem(t.id)}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-600"
                >
                  {t.label}
                </button>
              ))}
            </div>

            {addItem && (
              <div className="mb-6">
                <AddItemPanel
                  type={addItem}
                  workspaceId={workspaceId}
                  collectionId={collectionId}
                  onClose={() => setAddItem(null)}
                  onAdded={() => { setAddItem(null); fetchAll() }}
                />
              </div>
            )}

            {collection.entries.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
                <div className="text-2xl mb-2">📚</div>
                <p className="text-sm font-medium text-white mb-1">Empty collection</p>
                <p className="text-xs text-zinc-500">Add an item from the buttons above.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800 overflow-hidden bg-zinc-950">
                {collection.entries.map(e => (
                  <div key={e.id} className="p-4 hover:bg-zinc-900/40 transition-colors">
                    <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="text-sm font-semibold text-white truncate">{e.title}</h3>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{sourceLabel(e.source)}</span>
                          {e.status !== 'ready' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300">{e.status}</span>
                          )}
                        </div>
                        <p className="text-xs text-zinc-400 line-clamp-2 whitespace-pre-wrap">{e.content}</p>
                        <p className="text-[10px] text-zinc-600 mt-1">~{e.tokenEstimate} tokens · added {relTime(e.createdAt)}</p>
                      </div>
                      <button
                        onClick={() => deleteEntry(e.id)}
                        className="text-[11px] px-2.5 py-1 rounded-lg border border-zinc-800 text-red-400 hover:text-red-300 hover:border-red-500/40 transition-colors flex-shrink-0"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'data_sources' && (
          <DataSourcesTab
            workspaceId={workspaceId}
            collectionId={collectionId}
            sources={collection.dataSources}
            onChanged={fetchAll}
          />
        )}

        {tab === 'agents' && (
          <ConnectedAgentsTab
            workspaceId={workspaceId}
            collectionId={collectionId}
            allAgents={agents}
            connectedIds={collection.connectedAgents.map(a => a.id)}
            onChanged={fetchAll}
          />
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Add Item — switches the panel by type. Each adapter posts to a
// distinct endpoint under the collection.
// ──────────────────────────────────────────────────────────────────────

function AddItemPanel({
  type, workspaceId, collectionId, onClose, onAdded,
}: {
  type: Exclude<AddItem, null>
  workspaceId: string
  collectionId: string
  onClose: () => void
  onAdded: () => void
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs uppercase tracking-wider text-zinc-500 font-semibold">
          {type === 'manual' ? 'Write a new item'
            : type === 'qa' ? 'Q&A pairs'
            : type === 'url' ? 'Crawl a URL'
            : type === 'file' ? 'Upload a file'
            : type === 'notion' ? 'Import from Notion'
            : 'Import from YouTube'}
        </p>
        <button onClick={onClose} className="text-zinc-500 hover:text-white">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      {type === 'manual' && <ManualForm workspaceId={workspaceId} collectionId={collectionId} onAdded={onAdded} />}
      {type === 'qa'     && <QAForm     workspaceId={workspaceId} collectionId={collectionId} onAdded={onAdded} />}
      {type === 'url'    && <UrlForm    workspaceId={workspaceId} collectionId={collectionId} onAdded={onAdded} />}
      {type === 'file'   && <FileForm   workspaceId={workspaceId} collectionId={collectionId} onAdded={onAdded} />}
      {type === 'notion' && <NotionStub />}
      {type === 'youtube'&& <YouTubeStub />}
    </div>
  )
}

function ManualForm({ workspaceId, collectionId, onAdded }: { workspaceId: string; collectionId: string; onAdded: () => void }) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    if (!title.trim() || !content.trim()) { setErr('Both title and content are required.'); return }
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/knowledge/collections/${collectionId}/entries`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), content, source: 'manual' }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setErr(d.error || 'Save failed'); return
      }
      onAdded()
    } finally { setBusy(false) }
  }
  return (
    <div className="space-y-2">
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white" />
      <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Content" rows={6} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white resize-y" />
      {err && <p className="text-xs text-red-400">{err}</p>}
      <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50">
        {busy ? 'Saving…' : 'Add to collection'}
      </button>
    </div>
  )
}

function QAForm({ workspaceId, collectionId, onAdded }: { workspaceId: string; collectionId: string; onAdded: () => void }) {
  const [pairs, setPairs] = useState<Array<{ q: string; a: string }>>([{ q: '', a: '' }])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    const valid = pairs.filter(p => p.q.trim() && p.a.trim())
    if (valid.length === 0) { setErr('Add at least one Q&A pair.'); return }
    setBusy(true); setErr(null)
    try {
      // One entry per Q&A so the agent can match individually
      for (const p of valid) {
        const title = p.q.slice(0, 80)
        const content = `Q: ${p.q}\nA: ${p.a}`
        await fetch(`/api/workspaces/${workspaceId}/knowledge/collections/${collectionId}/entries`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content, source: 'qa' }),
        })
      }
      onAdded()
    } finally { setBusy(false) }
  }
  return (
    <div className="space-y-2">
      {pairs.map((p, i) => (
        <div key={i} className="space-y-1.5 p-2 rounded-lg bg-zinc-900 border border-zinc-800">
          <input value={p.q} onChange={e => setPairs(prev => prev.map((x, j) => j === i ? { ...x, q: e.target.value } : x))} placeholder="Question" className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-white" />
          <textarea value={p.a} onChange={e => setPairs(prev => prev.map((x, j) => j === i ? { ...x, a: e.target.value } : x))} placeholder="Answer" rows={2} className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-white resize-none" />
        </div>
      ))}
      <button type="button" onClick={() => setPairs(prev => [...prev, { q: '', a: '' }])} className="text-xs text-zinc-400 hover:text-white">+ Add another pair</button>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50">
        {busy ? 'Saving…' : 'Add to collection'}
      </button>
    </div>
  )
}

function UrlForm({ workspaceId, collectionId, onAdded }: { workspaceId: string; collectionId: string; onAdded: () => void }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  async function save() {
    if (!url.trim()) return
    setBusy(true); setStatus(null)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/knowledge/collections/${collectionId}/crawl`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setStatus(`✗ ${d.error || 'Crawl failed'}`); return }
      setStatus(`✓ Indexed ${d.chunks} chunk${d.chunks === 1 ? '' : 's'}`)
      onAdded()
    } finally { setBusy(false) }
  }
  return (
    <div className="space-y-2">
      <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/page" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white" />
      {status && <p className={`text-xs ${status.startsWith('✓') ? 'text-emerald-300' : 'text-red-400'}`}>{status}</p>}
      <button onClick={save} disabled={busy || !url.trim()} className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50">
        {busy ? 'Crawling…' : 'Crawl + add'}
      </button>
    </div>
  )
}

function FileForm({ workspaceId, collectionId, onAdded }: { workspaceId: string; collectionId: string; onAdded: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  async function upload(file: File) {
    setBusy(true); setStatus(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/knowledge/collections/${collectionId}/upload`, {
        method: 'POST', body: form,
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setStatus(`✗ ${d.error || 'Upload failed'}`); return }
      setStatus(`✓ ${d.fileName} → ${d.chunks} chunk${d.chunks === 1 ? '' : 's'}`)
      onAdded()
    } finally { setBusy(false) }
  }
  return (
    <div className="space-y-2">
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.txt,.md"
        onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f); if (e.target) e.target.value = '' }}
        className="text-xs text-zinc-400"
      />
      <p className="text-[10px] text-zinc-500">PDF, TXT, or Markdown. Max 5 MB.</p>
      {status && <p className={`text-xs ${status.startsWith('✓') ? 'text-emerald-300' : 'text-red-400'}`}>{status}</p>}
      {busy && <p className="text-xs text-zinc-400">Uploading…</p>}
    </div>
  )
}

function NotionStub() {
  return <p className="text-xs text-zinc-400">Notion import is being moved into the Collection editor. For now, paste the page contents using the Write tab — full Notion import returns shortly.</p>
}
function YouTubeStub() {
  return <p className="text-xs text-zinc-400">YouTube transcript import is being moved into the Collection editor. For now, paste the transcript using the Write tab — full import returns shortly.</p>
}

// ──────────────────────────────────────────────────────────────────────
// Data sources tab — list + create
// ──────────────────────────────────────────────────────────────────────

function DataSourcesTab({
  workspaceId, collectionId, sources, onChanged,
}: {
  workspaceId: string
  collectionId: string
  sources: DataSource[]
  onChanged: () => void
}) {
  const [creator, setCreator] = useState(false)
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-zinc-400">
          Live data lookups (Google Sheets, Airtable, REST). Agents connected to this collection get these as tools.
        </p>
        <button
          onClick={() => setCreator(true)}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-600"
        >
          + New data source
        </button>
      </div>
      {sources.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
          <div className="text-2xl mb-2">🔌</div>
          <p className="text-sm font-medium text-white mb-1">No data sources yet</p>
          <p className="text-xs text-zinc-500">Wire up a Sheet, Airtable base, or REST endpoint and it'll be available as a tool to every agent on this collection.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800 bg-zinc-950">
          {sources.map(s => (
            <div key={s.id} className="p-3 flex items-start gap-3">
              <span className="text-base flex-shrink-0">
                {s.kind === 'google_sheet' ? '📊' : s.kind === 'airtable' ? '🟪' : '🌐'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <code className="text-sm font-mono text-white">{s.name}</code>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{s.kind.replace('_', ' ')}</span>
                  {!s.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">paused</span>}
                </div>
                {s.description && <p className="text-xs text-zinc-400 mt-0.5">{s.description}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {creator && (
        <CreateDataSourceModal
          workspaceId={workspaceId}
          collectionId={collectionId}
          onClose={() => setCreator(false)}
          onCreated={() => { setCreator(false); onChanged() }}
        />
      )}
    </div>
  )
}

function CreateDataSourceModal({
  workspaceId, collectionId, onClose, onCreated,
}: { workspaceId: string; collectionId: string; onClose: () => void; onCreated: () => void }) {
  const [kind, setKind] = useState<'google_sheet' | 'airtable' | 'rest_get'>('google_sheet')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [config, setConfig] = useState<Record<string, string>>({})
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    if (!/^[a-z0-9_-]{2,40}$/.test(name)) { setErr('Name: 2–40 chars, lowercase letters/numbers/dashes/underscores.'); return }
    setBusy(true); setErr(null)
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/knowledge/collections/${collectionId}/data-sources`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, kind, description: description || null, config, secret: secret || undefined }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setErr(d.error || 'Create failed'); return
      }
      onCreated()
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">New data source</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">Kind</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id: 'google_sheet', label: '📊 Google Sheet' },
                { id: 'airtable',     label: '🟪 Airtable' },
                { id: 'rest_get',     label: '🌐 REST GET' },
              ] as Array<{ id: typeof kind; label: string }>).map(k => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => { setKind(k.id); setConfig({}) }}
                  className={`px-3 py-2 rounded-lg border text-xs transition-colors ${
                    kind === k.id ? 'border-orange-500 bg-orange-500/10 text-white' : 'border-zinc-700 text-zinc-300 hover:border-zinc-500'
                  }`}
                >{k.label}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">Slug name</label>
            <input value={name} onChange={e => setName(e.target.value.toLowerCase())} placeholder="inventory" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white font-mono" />
            <p className="text-[10px] text-zinc-500 mt-1">The agent calls it by this slug, e.g. <code>lookup_sheet(&quot;{name || 'inventory'}&quot;, ...)</code></p>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">Description</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder="What's in it?" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          {kind === 'google_sheet' && (
            <>
              <SimpleField label="Sheet URL or ID" value={config.url || ''} onChange={v => setConfig(c => ({ ...c, url: v }))} placeholder="docs.google.com/spreadsheets/d/..." />
              <SimpleField label="Tab / sheet name" value={config.sheet || ''} onChange={v => setConfig(c => ({ ...c, sheet: v }))} placeholder="Sheet1" />
              <SimpleField label="Service account JSON (paste contents)" value={secret} onChange={setSecret} placeholder="{ ... }" textarea />
            </>
          )}
          {kind === 'airtable' && (
            <>
              <SimpleField label="Base ID" value={config.baseId || ''} onChange={v => setConfig(c => ({ ...c, baseId: v }))} placeholder="appXXXXXXXX" />
              <SimpleField label="Table name" value={config.table || ''} onChange={v => setConfig(c => ({ ...c, table: v }))} placeholder="Products" />
              <SimpleField label="Personal access token" value={secret} onChange={setSecret} placeholder="patXXXX..." />
            </>
          )}
          {kind === 'rest_get' && (
            <>
              <SimpleField label="URL" value={config.url || ''} onChange={v => setConfig(c => ({ ...c, url: v }))} placeholder="https://api.example.com/items" />
              <SimpleField label="Auth header (optional)" value={config.authHeader || ''} onChange={v => setConfig(c => ({ ...c, authHeader: v }))} placeholder="Authorization: Bearer ..." />
              <SimpleField label="Token / API key (optional)" value={secret} onChange={setSecret} placeholder="" />
            </>
          )}
          {err && <p className="text-xs text-red-400">{err}</p>}
        </div>
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-zinc-300 hover:text-white">Cancel</button>
          <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50">
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SimpleField({ label, value, onChange, placeholder, textarea }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; textarea?: boolean }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1">{label}</label>
      {textarea
        ? <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={4} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white font-mono resize-y" />
        : <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white" />
      }
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────
// Connected agents tab
// ──────────────────────────────────────────────────────────────────────

function ConnectedAgentsTab({
  workspaceId, collectionId, allAgents, connectedIds, onChanged,
}: {
  workspaceId: string
  collectionId: string
  allAgents: AgentLite[]
  connectedIds: string[]
  onChanged: () => void
}) {
  const [picked, setPicked] = useState<string[]>(connectedIds)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setPicked(connectedIds) }, [connectedIds.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id: string) {
    setPicked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function save() {
    setSaving(true)
    try {
      await fetch(`/api/workspaces/${workspaceId}/knowledge/collections/${collectionId}/connections`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentIds: picked }),
      })
      onChanged()
    } finally { setSaving(false) }
  }

  const dirty = picked.length !== connectedIds.length || picked.some(id => !connectedIds.includes(id))

  return (
    <div>
      <p className="text-xs text-zinc-400 mb-3">
        Agents you check here will pull every item and data source from this collection at runtime. An agent can connect to as many collections as you like — they stack.
      </p>
      {allAgents.length === 0 ? (
        <p className="text-sm text-zinc-500 italic">No agents in this workspace yet.</p>
      ) : (
        <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800 bg-zinc-950">
          {allAgents.map(a => {
            const checked = picked.includes(a.id)
            return (
              <label key={a.id} className="flex items-center gap-3 p-3 hover:bg-zinc-900/40 cursor-pointer">
                <input type="checkbox" checked={checked} onChange={() => toggle(a.id)} className="accent-orange-500" />
                <span className="text-sm text-white">{a.name}</span>
              </label>
            )
          })}
        </div>
      )}
      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save connections'}
        </button>
      </div>
    </div>
  )
}
