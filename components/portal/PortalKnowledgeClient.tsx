'use client'

/**
 * Portal Knowledge — the brand-side of the ticket-reply brain.
 * Three sections per brand:
 *   1. Sources   — paste a link or upload a file; same ingest pipeline
 *                  the workspace Knowledge page uses, scoped to the brand.
 *   2. Snippets  — reusable links/blurbs (calendar link, contact details)
 *                  the support team can insert and the AI can quote.
 *   3. Reply rules — words/phrases the AI must never use for this brand.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface BrandOption { id: string; name: string; primaryColor: string | null }

interface SourceRow {
  id: string
  sourceType: string
  label: string
  isActive: boolean
  lastCrawledAt: string | null
  createdAt: string
  latestRun: { status: string; startedAt: string; completedAt: string | null; pagesSucceeded: number; chunksCreated: number } | null
  chunkCount: number
}

interface SnippetRow { id: string; title: string; content: string; kind: string; createdAt: string }

export default function PortalKnowledgeClient({ brands }: { brands: BrandOption[] }) {
  const [brandId, setBrandId] = useState(brands[0]?.id ?? '')

  return (
    <div className="mt-6 space-y-6">
      {brands.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          {brands.map(b => (
            <button
              key={b.id}
              onClick={() => setBrandId(b.id)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                b.id === brandId
                  ? 'border-[var(--portal-accent)] text-[var(--portal-accent)]'
                  : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
              style={b.id === brandId ? { background: 'color-mix(in srgb, var(--portal-accent) 12%, transparent)' } : undefined}
            >
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ background: b.primaryColor || 'var(--portal-accent)' }} />
                {b.name}
              </span>
            </button>
          ))}
        </div>
      )}

      {brandId && (
        <>
          <SourcesSection key={`src-${brandId}`} brandId={brandId} />
          <SnippetsSection key={`snip-${brandId}`} brandId={brandId} />
          <ReplyRulesSection key={`rules-${brandId}`} brandId={brandId} />
        </>
      )}
    </div>
  )
}

// ─── Sources ────────────────────────────────────────────────────────────────

function SourcesSection({ brandId }: { brandId: string }) {
  const [sources, setSources] = useState<SourceRow[]>([])
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/portal/knowledge/sources?brandId=${encodeURIComponent(brandId)}`)
    const data = await res.json().catch(() => ({}))
    if (Array.isArray(data.sources)) setSources(data.sources)
  }, [brandId])

  useEffect(() => { load() }, [load])

  // Poll while anything is still being read.
  const hasActive = sources.some(s => s.latestRun && ['queued', 'running'].includes(s.latestRun.status))
  useEffect(() => {
    if (!hasActive) return
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [hasActive, load])

  async function addUrl() {
    if (!url.trim()) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/portal/knowledge/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), brandId }),
      })
      const data = await res.json()
      if (!res.ok) { setNotice({ tone: 'error', text: data.error || 'Could not add that link.' }); return }
      setNotice({ tone: 'ok', text: data.alreadyExisted ? 'Already added — checking it again now.' : `Added — reading it now.` })
      setUrl('')
      load()
    } finally { setBusy(false) }
  }

  async function addFile(file: File) {
    setBusy(true)
    setNotice(null)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('brandId', brandId)
      const res = await fetch('/api/portal/knowledge/add', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) { setNotice({ tone: 'error', text: data.error || 'Upload failed.' }); return }
      setNotice({ tone: 'ok', text: `Uploaded ${file.name} — reading it now.` })
      load()
    } finally {
      setBusy(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function recheck(id: string) {
    await fetch(`/api/portal/knowledge/sources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'recheck' }),
    })
    load()
  }

  async function remove(id: string, label: string) {
    if (!confirm(`Remove "${label}" and everything learned from it?`)) return
    await fetch(`/api/portal/knowledge/sources/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <section className="rounded-xl border border-zinc-800 overflow-hidden" style={{ background: 'var(--surface)' }}>
      <SectionHeader
        title="Knowledge sources"
        sub="Paste a link (website, docs, YouTube, RSS) or upload a PDF / text file. The AI reads it and uses it when replying to your customers."
      />
      <div className="p-4 space-y-3">
        <div className="flex gap-2 flex-wrap">
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addUrl() }}
            placeholder="https://your-help-center.com"
            className="flex-1 min-w-[220px] rounded-lg px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[var(--portal-accent)]"
          />
          <button
            onClick={addUrl}
            disabled={busy || !url.trim()}
            className="text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50 text-zinc-950"
            style={{ background: 'var(--portal-accent)' }}
          >
            Add link
          </button>
          <button
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            className="text-xs font-semibold px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white disabled:opacity-50"
          >
            Upload file
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.txt,.md,.markdown"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) addFile(f) }}
          />
        </div>
        {notice && (
          <p className="text-[11px]" style={{ color: notice.tone === 'ok' ? 'var(--accent-emerald)' : 'var(--accent-red)' }}>
            {notice.text}
          </p>
        )}

        {sources.length === 0 ? (
          <p className="text-xs text-zinc-500 py-3">Nothing added yet. Start with your website or help center.</p>
        ) : (
          <ul className="divide-y divide-zinc-800 -mx-4 -mb-4 mt-1">
            {sources.map(s => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-zinc-100 truncate">{s.label}</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    <RunStatus run={s.latestRun} chunkCount={s.chunkCount} />
                  </p>
                </div>
                <button onClick={() => recheck(s.id)} className="text-[11px] text-zinc-400 hover:text-white shrink-0">Re-check</button>
                <button onClick={() => remove(s.id, s.label)} className="text-[11px] text-zinc-500 hover:text-red-400 shrink-0">Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function RunStatus({ run, chunkCount }: { run: SourceRow['latestRun']; chunkCount: number }) {
  if (!run) return <>Waiting to be read…</>
  if (run.status === 'queued') return <span className="text-amber-400">Queued — reading shortly…</span>
  if (run.status === 'running') return <span className="text-amber-400">Reading… {run.pagesSucceeded > 0 ? `${run.pagesSucceeded} pages so far` : ''}</span>
  if (run.status === 'failed') return <span className="text-red-400">Failed to read — try re-checking</span>
  const learned = chunkCount > 0 ? `${chunkCount} passages learned` : 'nothing extracted'
  return <span className="text-emerald-500">Ready · {learned}{run.status === 'partial' ? ' (partial read)' : ''}</span>
}

// ─── Snippets ───────────────────────────────────────────────────────────────

function SnippetsSection({ brandId }: { brandId: string }) {
  const [snippets, setSnippets] = useState<SnippetRow[]>([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/portal/brands/${brandId}/snippets`)
    const data = await res.json().catch(() => ({}))
    if (Array.isArray(data.snippets)) setSnippets(data.snippets)
  }, [brandId])

  useEffect(() => { load() }, [load])

  async function add() {
    if (!title.trim() || !content.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/portal/brands/${brandId}/snippets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), content: content.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Could not save snippet.'); return }
      setTitle('')
      setContent('')
      load()
    } finally { setBusy(false) }
  }

  async function remove(id: string, snippetTitle: string) {
    if (!confirm(`Remove snippet "${snippetTitle}"?`)) return
    await fetch(`/api/portal/brands/${brandId}/snippets/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <section className="rounded-xl border border-zinc-800 overflow-hidden" style={{ background: 'var(--surface)' }}>
      <SectionHeader
        title="Snippet library"
        sub="Reusable links and blurbs — your calendar link, contact details, policies. The support team can insert them into replies, and the AI will include one when it clearly helps."
      />
      <div className="p-4 space-y-3">
        <div className="grid sm:grid-cols-[200px_1fr_auto] gap-2">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Title — e.g. Book a call"
            className="rounded-lg px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[var(--portal-accent)]"
          />
          <input
            value={content}
            onChange={e => setContent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') add() }}
            placeholder="Content — e.g. https://cal.com/you/30min"
            className="rounded-lg px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[var(--portal-accent)]"
          />
          <button
            onClick={add}
            disabled={busy || !title.trim() || !content.trim()}
            className="text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50 text-zinc-950"
            style={{ background: 'var(--portal-accent)' }}
          >
            Add snippet
          </button>
        </div>
        {error && <p className="text-[11px]" style={{ color: 'var(--accent-red)' }}>{error}</p>}

        {snippets.length === 0 ? (
          <p className="text-xs text-zinc-500 py-3">No snippets yet. A calendar link is a great first one.</p>
        ) : (
          <ul className="divide-y divide-zinc-800 -mx-4 -mb-4 mt-1">
            {snippets.map(s => (
              <li key={s.id} className="flex items-start gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-zinc-100">
                    {s.title}
                    {s.kind === 'link' && (
                      <span className="ml-2 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border border-zinc-700 text-zinc-400">link</span>
                    )}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5 break-all line-clamp-2">{s.content}</p>
                </div>
                <button onClick={() => remove(s.id, s.title)} className="text-[11px] text-zinc-500 hover:text-red-400 shrink-0 mt-0.5">Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

// ─── Reply rules (negative keywords) ────────────────────────────────────────

function ReplyRulesSection({ brandId }: { brandId: string }) {
  const [keywords, setKeywords] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/portal/brands/${brandId}/reply-settings`)
      .then(r => r.json())
      .then(data => { if (!cancelled && Array.isArray(data.negativeKeywords)) setKeywords(data.negativeKeywords) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [brandId])

  function addKeyword() {
    const k = input.trim()
    if (!k) return
    if (!keywords.some(x => x.toLowerCase() === k.toLowerCase())) {
      setKeywords([...keywords, k])
      setDirty(true)
    }
    setInput('')
  }

  function removeKeyword(k: string) {
    setKeywords(keywords.filter(x => x !== k))
    setDirty(true)
  }

  async function save() {
    setSaving(true)
    setNotice(null)
    try {
      const res = await fetch(`/api/portal/brands/${brandId}/reply-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ negativeKeywords: keywords }),
      })
      const data = await res.json()
      if (!res.ok) { setNotice(data.error || 'Save failed.'); return }
      setDirty(false)
      setNotice('Saved.')
    } finally { setSaving(false) }
  }

  return (
    <section className="rounded-xl border border-zinc-800 overflow-hidden" style={{ background: 'var(--surface)' }}>
      <SectionHeader
        title="Words to avoid"
        sub="Words and phrases the AI must never use when drafting replies for this brand — competitor names, banned claims, off-brand slang."
      />
      <div className="p-4 space-y-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addKeyword() }}
            placeholder='e.g. "guarantee", "cheap", a competitor name'
            className="flex-1 rounded-lg px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[var(--portal-accent)]"
          />
          <button
            onClick={addKeyword}
            disabled={!input.trim()}
            className="text-xs font-semibold px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white disabled:opacity-50"
          >
            Add
          </button>
        </div>

        {keywords.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {keywords.map(k => (
              <span key={k} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border border-zinc-700 text-zinc-200">
                {k}
                <button onClick={() => removeKeyword(k)} className="text-zinc-500 hover:text-red-400" aria-label={`Remove ${k}`}>×</button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50 text-zinc-950"
            style={{ background: 'var(--portal-accent)' }}
          >
            {saving ? 'Saving…' : 'Save rules'}
          </button>
          {notice && <p className="text-[11px] text-zinc-400">{notice}</p>}
        </div>
      </div>
    </section>
  )
}

function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="px-4 py-3 border-b border-zinc-800">
      <p className="text-sm font-semibold text-zinc-100">{title}</p>
      <p className="text-[11px] text-zinc-500 mt-0.5">{sub}</p>
    </div>
  )
}
