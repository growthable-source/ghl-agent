'use client'

/**
 * Knowledge pipeline admin — domains, taxonomy, sources, runs.
 *
 * One page, four tabs. Each tab is scoped to the currently-selected
 * domain (Domains tab is the entry point). Built deliberately
 * lightweight: prompts + lists + JSON inputs. Pretty-up after we
 * know which workflows operators actually do daily.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

type Tab = 'domains' | 'taxonomy' | 'sources' | 'runs'

interface Workspace { id: string; name: string }
interface Domain {
  id: string
  name: string
  description: string | null
  defaultIntentTags: string[]
  createdAt: string
  taxonomyCount: number
  sourceCount: number
  chunkCount: number
}
interface Taxonomy { id: string; key: string; label: string; aliases: string[]; parentKey: string | null }
interface UnmatchedChunk { id: string; primaryTopic: string | null; content: string; sourceUrl: string; sourceMetadata: any; createdAt: string }
interface Source {
  id: string
  sourceType: string
  urlOrIdentifier: string
  crawlConfig: any
  isActive: boolean
  lastCrawledAt: string | null
  liveChunks: number
  runCount: number
}
interface Run {
  id: string
  sourceId: string
  source: { id: string; sourceType: string; urlOrIdentifier: string }
  startedAt: string
  completedAt: string | null
  status: string
  pagesAttempted: number
  pagesSucceeded: number
  chunksCreated: number
  chunksSuperseded: number
  errorLog: Array<{ url: string; stage: string; message: string; ts: string }>
}

export default function KnowledgePipelinePage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('domains')

  const [domains, setDomains] = useState<Domain[]>([])
  const [domainId, setDomainId] = useState<string | null>(null)
  const [notMigrated, setNotMigrated] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const [taxonomies, setTaxonomies] = useState<Taxonomy[]>([])
  const [unmatched, setUnmatched] = useState<UnmatchedChunk[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [runs, setRuns] = useState<Run[]>([])

  // Bootstrap workspaces.
  useEffect(() => {
    fetch('/api/workspaces')
      .then(r => r.json())
      .then(d => {
        const list: Workspace[] = (d.workspaces ?? []).map((w: any) => ({ id: w.id, name: w.name }))
        setWorkspaces(list)
        if (list.length && !workspaceId) setWorkspaceId(list[0].id)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadDomains = useCallback(async () => {
    if (!workspaceId) return
    const res = await fetch(`/api/admin/knowledge-domains?workspaceId=${workspaceId}`)
    const data = await res.json()
    setDomains(data.domains ?? [])
    setNotMigrated(!!data.notMigrated)
    if (!domainId && data.domains?.length) setDomainId(data.domains[0].id)
  }, [workspaceId, domainId])

  useEffect(() => { loadDomains() }, [loadDomains])

  const loadTaxonomy = useCallback(async () => {
    if (!domainId) return
    const [tax, un] = await Promise.all([
      fetch(`/api/admin/taxonomies?knowledgeDomainId=${domainId}`).then(r => r.json()),
      fetch(`/api/admin/taxonomies?knowledgeDomainId=${domainId}&unmatched=1`).then(r => r.json()),
    ])
    setTaxonomies(tax.taxonomies ?? [])
    setUnmatched(un.unmatchedChunks ?? [])
  }, [domainId])

  const loadSources = useCallback(async () => {
    if (!domainId) return
    const res = await fetch(`/api/admin/sources?knowledgeDomainId=${domainId}`)
    const data = await res.json()
    setSources(data.sources ?? [])
  }, [domainId])

  const loadRuns = useCallback(async () => {
    if (!domainId) return
    const res = await fetch(`/api/admin/ingestion-runs?knowledgeDomainId=${domainId}`)
    const data = await res.json()
    setRuns(data.runs ?? [])
  }, [domainId])

  useEffect(() => {
    if (tab === 'taxonomy') loadTaxonomy()
    if (tab === 'sources') loadSources()
    if (tab === 'runs') loadRuns()
  }, [tab, loadTaxonomy, loadSources, loadRuns])

  async function createDomain() {
    if (!workspaceId) return
    const name = prompt('Domain name? (e.g. "Product Support", "Legal", "Coaching")')
    if (!name?.trim()) return
    setBusy('domain')
    try {
      const res = await fetch('/api/admin/knowledge-domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          name: name.trim(),
          defaultIntentTags: ['how_to', 'troubleshooting', 'pricing', 'concept'],
        }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? 'create failed'); return }
      await loadDomains()
      if (data.domain?.id) setDomainId(data.domain.id)
    } finally { setBusy(null) }
  }

  async function createTaxonomy() {
    if (!domainId) return
    const key = prompt('Taxonomy key (lowercase, no spaces — e.g. "workflows"):')?.trim()
    if (!key) return
    const label = prompt('Display label (e.g. "Workflows"):', key.replace(/\b\w/g, c => c.toUpperCase()))?.trim()
    if (!label) return
    const aliasesRaw = prompt('Aliases (comma-separated, optional):', '')
    const aliases = (aliasesRaw ?? '').split(',').map(s => s.trim()).filter(Boolean)
    const parentKey = prompt('Parent key (optional, leave blank for top level):', '')?.trim() || null
    setBusy('taxonomy')
    try {
      const res = await fetch('/api/admin/taxonomies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ knowledgeDomainId: domainId, key, label, aliases, parentKey }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? 'create failed'); return }
      await loadTaxonomy()
    } finally { setBusy(null) }
  }

  async function createSource() {
    if (!domainId) return
    const sourceType = prompt('Source type? (docs | pdf | youtube | rss | community | manual)', 'docs')?.trim()
    if (!sourceType) return
    const urlOrIdentifier = prompt(
      sourceType === 'pdf' ? 'PDF storage key (Vercel Blob path):' : 'URL:',
    )?.trim()
    if (!urlOrIdentifier) return
    setBusy('source')
    try {
      const res = await fetch('/api/admin/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          knowledgeDomainId: domainId,
          sourceType,
          urlOrIdentifier,
          crawlConfig: sourceType === 'docs' ? { recrawlIntervalDays: 7 } : {},
        }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? 'create failed'); return }
      await loadSources()
    } finally { setBusy(null) }
  }

  async function runSource(sourceId: string) {
    if (!confirm('Run ingest now? Will block until the source finishes (up to 5 min).')) return
    setBusy(`run-${sourceId}`)
    try {
      const res = await fetch(`/api/admin/sources/${sourceId}/run`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? 'ingest failed'); return }
      alert(`Status: ${data.status}\nPages: ${data.pagesSucceeded}/${data.pagesAttempted}\nChunks created: ${data.chunksCreated}\nChunks superseded: ${data.chunksSuperseded}`)
      await Promise.all([loadSources(), loadRuns()])
    } finally { setBusy(null) }
  }

  const currentDomain = domains.find(d => d.id === domainId)

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Knowledge pipeline</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Domains, taxonomy, sources, ingestion runs. The Phase 2 RAG layer.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>Workspace</span>
            <select
              value={workspaceId ?? ''}
              onChange={e => setWorkspaceId(e.target.value || null)}
              className="text-sm rounded px-2 py-1"
              style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
            >
              {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
        </div>

        {notMigrated && (
          <div className="rounded-xl p-4 mb-6" style={{ background: 'var(--accent-amber-bg)', border: '1px solid var(--accent-amber-bg)' }}>
            <p className="text-sm" style={{ color: 'var(--accent-amber)' }}>
              Run <code className="bg-black/30 px-1 rounded">prisma/migrations-legacy/manual_phase2_knowledge_pipeline.sql</code> to enable the pipeline.
            </p>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-4 p-1 rounded-lg w-fit" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
          {([
            ['domains',  'Domains'],
            ['taxonomy', 'Taxonomy'],
            ['sources',  'Sources'],
            ['runs',     'Runs'],
          ] as Array<[Tab, string]>).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              disabled={id !== 'domains' && !domainId}
              className="text-xs font-medium px-3 py-1.5 rounded-md disabled:opacity-40 transition-colors"
              style={tab === id
                ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }
                : { color: 'var(--text-tertiary)' }}
            >
              {label}
            </button>
          ))}
          <span className="ml-3 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            {currentDomain ? `Domain: ${currentDomain.name}` : '— pick a domain →'}
          </span>
        </div>

        {tab === 'domains' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Domains in this workspace</h2>
              <button
                onClick={createDomain}
                disabled={busy === 'domain' || !workspaceId}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
                style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
              >
                + New domain
              </button>
            </div>
            {domains.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                No domains yet. Create one — it&apos;s the pool every chunk lives in.
              </p>
            ) : (
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                {domains.map(d => (
                  <button
                    key={d.id}
                    onClick={() => { setDomainId(d.id); setTab('taxonomy') }}
                    className="w-full text-left p-4 border-t hover:bg-zinc-900/40 transition-colors first:border-t-0"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{d.name}</p>
                        {d.description && (
                          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{d.description}</p>
                        )}
                      </div>
                      <div className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        {d.taxonomyCount} taxonomy · {d.sourceCount} sources · {d.chunkCount} chunks
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'taxonomy' && domainId && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Taxonomy · {currentDomain?.name}</h2>
              <button
                onClick={createTaxonomy}
                disabled={busy === 'taxonomy'}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
                style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
              >
                + New tag
              </button>
            </div>
            <div className="rounded-xl border overflow-hidden mb-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              {taxonomies.length === 0 ? (
                <p className="p-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>No taxonomy yet — add some keys so ingest can classify.</p>
              ) : taxonomies.map(t => (
                <div key={t.id} className="p-3 border-t first:border-t-0 flex items-center gap-3" style={{ borderColor: 'var(--border)' }}>
                  <code className="text-xs px-1.5 py-0.5 rounded font-mono" style={{ background: 'var(--surface-secondary)', color: 'var(--text-secondary)' }}>{t.key}</code>
                  <span className="text-sm flex-1" style={{ color: 'var(--text-primary)' }}>{t.label}</span>
                  {t.parentKey && <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>under {t.parentKey}</span>}
                  {t.aliases.length > 0 && <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>aliases: {t.aliases.join(', ')}</span>}
                </div>
              ))}
            </div>

            <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
              _other bucket · {unmatched.length} chunks the classifier couldn&apos;t place
            </h2>
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              {unmatched.length === 0 ? (
                <p className="p-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>Nothing in the bucket. Either every chunk fit a taxonomy key, or no chunks have been ingested yet.</p>
              ) : unmatched.map(c => (
                <div key={c.id} className="p-3 border-t first:border-t-0" style={{ borderColor: 'var(--border)' }}>
                  <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{c.primaryTopic || '(no topic)'}</p>
                  <p className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>{c.sourceUrl}</p>
                  <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{c.content.slice(0, 240)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'sources' && domainId && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Sources · {currentDomain?.name}</h2>
              <button
                onClick={createSource}
                disabled={busy === 'source'}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
                style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
              >
                + New source
              </button>
            </div>
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              {sources.length === 0 ? (
                <p className="p-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>No sources yet — add one to start ingesting.</p>
              ) : sources.map(s => (
                <div key={s.id} className="p-3 border-t first:border-t-0 flex items-center gap-3" style={{ borderColor: 'var(--border)' }}>
                  <code className="text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold" style={{ background: 'var(--surface-secondary)', color: 'var(--text-secondary)' }}>{s.sourceType}</code>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{s.urlOrIdentifier}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      {s.liveChunks} live chunks · {s.runCount} runs · {s.lastCrawledAt ? `last ${timeAgo(s.lastCrawledAt)}` : 'never crawled'}
                    </p>
                  </div>
                  <button
                    onClick={() => runSource(s.id)}
                    disabled={busy === `run-${s.id}`}
                    className="text-[11px] font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
                    style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
                  >
                    {busy === `run-${s.id}` ? 'Running…' : 'Run now'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'runs' && domainId && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Ingestion runs · {currentDomain?.name}</h2>
              <button onClick={loadRuns} className="text-xs text-zinc-400 hover:text-zinc-200">Refresh</button>
            </div>
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              {runs.length === 0 ? (
                <p className="p-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>No runs yet.</p>
              ) : runs.map(r => (
                <details key={r.id} className="border-t first:border-t-0" style={{ borderColor: 'var(--border)' }}>
                  <summary className="p-3 flex items-center gap-3 cursor-pointer hover:bg-zinc-900/40 transition-colors">
                    <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded"
                      style={{
                        background: r.status === 'success' ? 'var(--accent-emerald-bg)'
                                  : r.status === 'partial' ? 'var(--accent-amber-bg)'
                                  : r.status === 'failed'  ? 'var(--accent-red-bg)'
                                  : 'var(--surface-secondary)',
                        color: r.status === 'success' ? 'var(--accent-emerald)'
                             : r.status === 'partial' ? 'var(--accent-amber)'
                             : r.status === 'failed'  ? 'var(--accent-red)'
                             : 'var(--text-tertiary)',
                      }}>
                      {r.status}
                    </span>
                    <span className="text-xs flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                      {r.source.sourceType} · {r.source.urlOrIdentifier}
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      {r.pagesSucceeded}/{r.pagesAttempted} pages · +{r.chunksCreated} / ~{r.chunksSuperseded} · {timeAgo(r.startedAt)}
                    </span>
                  </summary>
                  {r.errorLog && r.errorLog.length > 0 && (
                    <div className="p-3" style={{ background: 'var(--surface-secondary)' }}>
                      <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--text-tertiary)' }}>Errors</p>
                      {r.errorLog.map((e, i) => (
                        <div key={i} className="mb-2 text-[11px]">
                          <p style={{ color: 'var(--accent-red)' }}>{e.stage}: {e.message}</p>
                          <p style={{ color: 'var(--text-tertiary)' }}>{e.url}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </details>
              ))}
            </div>
          </div>
        )}

        <p className="text-[10px] mt-8 text-center" style={{ color: 'var(--text-muted)' }}>
          Smoke test: <Link href="#" className="underline">create a domain</Link> → add a taxonomy entry → add a docs source pointing at any help-center URL → Run now → run again, confirm zero new chunks created on the second run.
        </p>
      </div>
    </div>
  )
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
