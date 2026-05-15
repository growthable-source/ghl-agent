'use client'

/**
 * Knowledge admin — guided UI for non-technical users.
 *
 * Top-level flow:
 *   1. No collection → welcome card + "Get started" → template picker
 *   2. Template picked → name it → seeded taxonomy + intent tags drop in
 *   3. Add source → source-type cards (Help Center / PDF / etc.) → URL → save
 *   4. Read now → ASYNC kick-off + live progress modal polling every 2s
 *   5. Tabs (Sources / Topics / History) are flat, simple, scannable
 *
 * No prompt() calls. No raw slugs. No DB jargon in error messages.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'

interface Domain {
  id: string
  name: string
  description: string | null
  defaultIntentTags: string[]
  taxonomyCount: number
  sourceCount: number
  chunkCount: number
  createdAt: string
}
interface Taxonomy { id: string; key: string; label: string; aliases: string[]; parentKey: string | null }
interface UnmatchedChunk { id: string; primaryTopic: string | null; content: string; sourceUrl: string; createdAt: string }
interface Source {
  id: string
  sourceType: string
  urlOrIdentifier: string
  isActive: boolean
  lastCrawledAt: string | null
  liveChunks: number
  runCount: number
  crawlConfig: { recrawlIntervalDays?: number; [k: string]: unknown }
}
interface Run {
  id: string
  sourceId: string
  source: { sourceType: string; urlOrIdentifier: string }
  startedAt: string
  completedAt: string | null
  status: 'running' | 'success' | 'partial' | 'failed'
  pagesAttempted: number
  pagesSucceeded: number
  chunksCreated: number
  chunksSuperseded: number
  errorLog: Array<{ url: string; stage: string; message: string; ts: string }>
}
interface DomainTemplate {
  id: string
  name: string
  description: string
  icon: string
  intentTags: string[]
  taxonomyPreview: string[]
  taxonomyCount: number
}
interface SourceTypeCard {
  sourceType: string
  name: string
  description: string
  icon: string
  available: boolean
  identifierLabel: string
  identifierPlaceholder: string
  identifierHint: string
  defaultConfig: Record<string, unknown>
}

type Tab = 'sources' | 'taxonomy' | 'history'

export default function KnowledgePipelinePage() {
  // workspaceId is already in the URL since this page lives under
  // /dashboard/[workspaceId]/knowledge-sources — no need to fetch the
  // workspace list or render a switcher. The sidebar already scopes
  // the user to one workspace at a time.
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [domains, setDomains] = useState<Domain[]>([])
  const [domainId, setDomainId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('sources')
  const [notMigrated, setNotMigrated] = useState(false)
  const [loading, setLoading] = useState(true)

  const [templates, setTemplates] = useState<DomainTemplate[]>([])
  const [sourceTypeCards, setSourceTypeCards] = useState<SourceTypeCard[]>([])

  const [taxonomies, setTaxonomies] = useState<Taxonomy[]>([])
  const [unmatched, setUnmatched] = useState<UnmatchedChunk[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [runs, setRuns] = useState<Run[]>([])

  const [createDomainOpen, setCreateDomainOpen] = useState(false)
  const [addSourceOpen, setAddSourceOpen] = useState(false)
  // The modal is shown when an active run is selected. The operator can
  // dismiss the modal at any time — the ingest keeps running on the
  // server and a floating pill at the bottom of the page lets them
  // re-open it. Three pieces of state:
  //
  //   activeRunId        — currently-displayed run (modal open)
  //   backgroundRunId    — run still polling after the operator closed
  //                        the modal; the floating pill watches this
  //   completedRun       — short-lived "ingest finished" toast payload
  //
  // Splitting "open in modal" from "polling in background" is what
  // lets the operator navigate elsewhere while ingestion continues.
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [backgroundRunId, setBackgroundRunId] = useState<string | null>(null)
  const [backgroundRun, setBackgroundRun] = useState<{
    id: string
    status: 'running' | 'success' | 'partial' | 'failed'
    pagesAttempted: number
    pagesSucceeded: number
    chunksCreated: number
  } | null>(null)
  const [completedToast, setCompletedToast] = useState<{ message: string; tone: 'success' | 'warning' | 'error' } | null>(null)
  const [diagnosticOpen, setDiagnosticOpen] = useState(false)

  useEffect(() => {
    fetch('/api/admin/domain-templates')
      .then(r => r.json())
      .then(tplData => {
        setTemplates(tplData.domainTemplates ?? [])
        setSourceTypeCards(tplData.sourceTypeCards ?? [])
      })
      .catch(() => {})
  }, [])

  const loadDomains = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/knowledge-domains?workspaceId=${workspaceId}`)
      const data = await res.json()
      setDomains(data.domains ?? [])
      setNotMigrated(!!data.notMigrated)
      if (data.domains?.length && !data.domains.find((d: Domain) => d.id === domainId)) {
        setDomainId(data.domains[0].id)
      } else if (!data.domains?.length) {
        setDomainId(null)
      }
    } finally { setLoading(false) }
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
    if (!domainId) return
    if (tab === 'sources') { loadSources(); loadRuns() }
    if (tab === 'taxonomy') loadTaxonomy()
    if (tab === 'history') loadRuns()
  }, [tab, domainId, loadSources, loadRuns, loadTaxonomy])

  // Page-level polling for the in-flight run. Drives the floating
  // pill at the bottom of the page when the operator has dismissed
  // the progress modal but ingestion is still running on the server.
  // Stops on completion + shows a "Done" toast.
  useEffect(() => {
    if (!backgroundRunId) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      try {
        const res = await fetch(`/api/admin/ingestion-runs/${backgroundRunId}`)
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        setBackgroundRun(data)
        if (data.status === 'running') {
          timer = setTimeout(tick, 3000)
          return
        }
        // Completed — celebrate, refresh lists, drop the pill.
        const message =
          data.status === 'success' ? `Done — added ${data.chunksCreated} new ${data.chunksCreated === 1 ? 'entry' : 'entries'}.` :
          data.status === 'partial' ? `Finished with errors — ${data.pagesSucceeded} of ${data.pagesAttempted} pages read.` :
          'Ingestion failed.'
        const tone = data.status === 'success' ? 'success' as const
          : data.status === 'failed' ? 'error' as const
          : 'warning' as const
        setCompletedToast({ message, tone })
        await Promise.all([loadSources(), loadRuns(), loadDomains()])
        setBackgroundRunId(null)
        setBackgroundRun(null)
        // Auto-dismiss the toast after 6 seconds.
        setTimeout(() => setCompletedToast(null), 6000)
      } catch {
        timer = setTimeout(tick, 4000)
      }
    }
    tick()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [backgroundRunId, loadSources, loadRuns, loadDomains])

  async function startIngest(sourceId: string) {
    const res = await fetch(`/api/admin/sources/${sourceId}/run`, { method: 'POST' })
    const data = await res.json()
    if (!res.ok || !data.runId) {
      alert(data.error ?? 'Couldn\'t start. Please try again in a minute.')
      return
    }
    setActiveRunId(data.runId)
  }

  const currentDomain = domains.find(d => d.id === domainId) ?? null

  if (notMigrated) {
    return (
      <Centered>
        <div className="text-3xl mb-4">⚙️</div>
        <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Setting things up</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          The knowledge layer isn&apos;t enabled on this database yet. The fix is a one-time setup from our side — drop us a note and we&apos;ll have it on within the hour.
        </p>
      </Centered>
    )
  }

  if (loading) return <Centered><p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p></Centered>

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-8">
        <div className="mb-6 flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Knowledge</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Connect your help center, docs, or PDFs. Your AI reads them automatically.
            </p>
          </div>
          <button
            onClick={() => setDiagnosticOpen(true)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg border hover:bg-zinc-900 transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            title="Check that Voyage, Firecrawl, and Anthropic are all reachable"
          >
            Check connections
          </button>
        </div>

        {domains.length === 0 ? (
          <WelcomeAndTemplates templates={templates} onPicked={() => setCreateDomainOpen(true)} />
        ) : (
          <>
            {domains.length > 1 && (
              <div className="mb-4 flex items-center gap-2 flex-wrap">
                {domains.map(d => (
                  <button
                    key={d.id}
                    onClick={() => setDomainId(d.id)}
                    className="text-xs font-medium px-3 py-1.5 rounded-full border transition-colors"
                    style={domainId === d.id
                      ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' }
                      : { background: 'var(--surface)', color: 'var(--text-tertiary)', borderColor: 'var(--border)' }}
                  >
                    {d.name}
                  </button>
                ))}
                <button
                  onClick={() => setCreateDomainOpen(true)}
                  className="text-xs font-medium px-3 py-1.5 rounded-full border border-dashed hover:bg-zinc-900 transition-colors"
                  style={{ color: 'var(--text-tertiary)', borderColor: 'var(--border)' }}
                >
                  + New collection
                </button>
              </div>
            )}

            {currentDomain && (
              <>
                <div className="flex items-center gap-1 mb-5 p-1 rounded-lg w-fit"
                  style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
                  {([
                    ['sources',  `Sources · ${currentDomain.sourceCount}`],
                    ['taxonomy', `Topics · ${currentDomain.taxonomyCount}`],
                    ['history',  'History'],
                  ] as Array<[Tab, string]>).map(([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setTab(id)}
                      className="text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
                      style={tab === id
                        ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }
                        : { color: 'var(--text-tertiary)' }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {tab === 'sources' && (
                  <SourcesTab
                    sources={sources}
                    runs={runs}
                    onAdd={() => setAddSourceOpen(true)}
                    onRun={startIngest}
                    onWatchRun={setActiveRunId}
                    onChanged={loadSources}
                  />
                )}
                {tab === 'taxonomy' && (
                  <TaxonomyTab
                    taxonomies={taxonomies}
                    unmatched={unmatched}
                    domainId={domainId!}
                    onChange={loadTaxonomy}
                  />
                )}
                {tab === 'history' && (
                  <HistoryTab runs={runs} />
                )}
              </>
            )}
          </>
        )}
      </div>

      {createDomainOpen && (
        <CreateDomainModal
          templates={templates}
          workspaceId={workspaceId}
          onClose={() => setCreateDomainOpen(false)}
          onCreated={async (id) => {
            setCreateDomainOpen(false)
            await loadDomains()
            setDomainId(id)
            setTab('sources')
          }}
        />
      )}
      {addSourceOpen && domainId && (
        <AddSourceModal
          sourceTypeCards={sourceTypeCards}
          knowledgeDomainId={domainId}
          onClose={() => setAddSourceOpen(false)}
          onCreated={async () => {
            setAddSourceOpen(false)
            await loadSources()
            await loadDomains()
          }}
        />
      )}
      {activeRunId && (
        <RunProgressModal
          runId={activeRunId}
          onClose={async (run) => {
            // If the run is still going, hand it off to the
            // page-level background poll — operator gets a floating
            // pill at the bottom they can click to re-open the modal.
            // If it finished, just refresh the lists.
            if (run && run.status === 'running') {
              setBackgroundRunId(run.id)
            } else {
              await Promise.all([loadSources(), loadRuns(), loadDomains()])
            }
            setActiveRunId(null)
          }}
        />
      )}
      {diagnosticOpen && (
        <DiagnosticModal onClose={() => setDiagnosticOpen(false)} />
      )}

      {/* Background-ingest pill — appears bottom-right while a run
          continues after the operator dismissed the modal. Click
          re-opens the modal so they can watch progress / errors. */}
      {backgroundRunId && backgroundRun && backgroundRun.status === 'running' && (
        <button
          onClick={() => {
            setActiveRunId(backgroundRunId)
            setBackgroundRunId(null)
          }}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full shadow-xl border transition-colors hover:opacity-90"
          style={{
            background: 'var(--surface)',
            borderColor: 'var(--accent-amber, #f59e0b)',
            color: 'var(--text-primary)',
          }}
          aria-label="Open ingest progress"
        >
          <span className="relative inline-flex w-2 h-2">
            <span className="absolute inset-0 rounded-full animate-ping" style={{ background: 'var(--accent-amber, #f59e0b)' }} />
            <span className="relative inline-block w-2 h-2 rounded-full" style={{ background: 'var(--accent-amber, #f59e0b)' }} />
          </span>
          <span className="text-xs font-semibold">
            Reading{backgroundRun.pagesAttempted > 0 ? ` · ${backgroundRun.pagesSucceeded}/${backgroundRun.pagesAttempted}` : '…'}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            View
          </span>
        </button>
      )}

      {/* Completion toast — short-lived banner when an in-background
          run finishes. Auto-dismisses after 6s; click to dismiss
          early. Position above the pill area so they don't stack. */}
      {completedToast && (
        <button
          onClick={() => setCompletedToast(null)}
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-xl border transition-colors text-left"
          style={{
            background: 'var(--surface)',
            borderColor: completedToast.tone === 'success' ? 'var(--accent-emerald, #22c55e)'
                       : completedToast.tone === 'warning' ? 'var(--accent-amber, #f59e0b)'
                       : 'var(--accent-red, #ef4444)',
          }}
        >
          <span className="text-base">
            {completedToast.tone === 'success' ? '✓' : completedToast.tone === 'warning' ? '⚠' : '✗'}
          </span>
          <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
            {completedToast.message}
          </span>
          <span className="text-[10px] ml-2" style={{ color: 'var(--text-tertiary)' }}>×</span>
        </button>
      )}
    </div>
  )
}

// ─── Diagnostic modal ────────────────────────────────────────────────────

interface DiagnosticCheck {
  service: string
  name: string
  status: 'ok' | 'missing_key' | 'invalid_key' | 'unreachable' | 'rate_limited' | 'other'
  detail: string
  fix: string | null
}

function DiagnosticModal({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [checks, setChecks] = useState<DiagnosticCheck[]>([])
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/ingest-diagnostic')
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Diagnostic failed.')
        return
      }
      setChecks(data.checks ?? [])
    } catch (err: any) {
      setError(err?.message ?? 'Network error.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { run() }, [run])

  return (
    <Modal title="Connection check" onClose={onClose} maxW="max-w-lg">
      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Probing services…</p>
      ) : error ? (
        <p className="text-sm text-red-400">{error}</p>
      ) : (
        <>
          <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
            We checked every service the knowledge pipeline talks to. Anything red below is your problem.
          </p>
          <div className="space-y-2">
            {checks.map(c => (
              <div key={c.service} className="rounded-lg border p-3"
                style={{
                  borderColor: c.status === 'ok' ? 'var(--accent-emerald)' : 'var(--accent-red)',
                  background: c.status === 'ok' ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                }}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base">{c.status === 'ok' ? '✅' : '❌'}</span>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{c.name}</p>
                </div>
                <p className="text-xs ml-7" style={{ color: 'var(--text-secondary)' }}>{c.detail}</p>
                {c.fix && (
                  <p className="text-[11px] ml-7 mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
                    <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Fix: </span>
                    {c.fix}
                  </p>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={run}
              className="text-xs px-3 py-1.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Re-check
            </button>
            <button
              onClick={onClose}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg"
              style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
            >
              Close
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

// ─── Welcome / first-run ─────────────────────────────────────────────────

function WelcomeAndTemplates({ templates, onPicked }: { templates: DomainTemplate[]; onPicked: () => void }) {
  return (
    <div className="rounded-2xl border p-8 text-center" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      <div className="text-4xl mb-3">📚</div>
      <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Give your AI a brain</h2>
      <p className="text-sm max-w-md mx-auto mb-6" style={{ color: 'var(--text-secondary)' }}>
        Connect a help center, upload PDFs, or point at any documentation. We&apos;ll read it, index it, and your AI will answer from it automatically.
      </p>
      <button
        onClick={onPicked}
        className="text-sm font-semibold px-6 py-2.5 rounded-lg"
        style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
      >
        Get started
      </button>

      {templates.length > 0 && (
        <div className="mt-8 pt-8 border-t" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[10px] uppercase tracking-wider font-semibold mb-4" style={{ color: 'var(--text-tertiary)' }}>
            We&apos;ll start you with a template
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-left">
            {templates.slice(0, 6).map(t => (
              <div key={t.id} className="p-3 rounded-lg border"
                style={{ background: 'var(--surface-secondary)', borderColor: 'var(--border)' }}>
                <div className="text-2xl mb-1.5">{t.icon}</div>
                <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>{t.name}</p>
                <p className="text-[10px] line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>{t.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Create-domain modal ────────────────────────────────────────────────

function CreateDomainModal({ templates, workspaceId, onClose, onCreated }: {
  templates: DomainTemplate[]
  workspaceId: string
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [step, setStep] = useState<'pick' | 'name'>('pick')
  const [chosen, setChosen] = useState<DomainTemplate | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function pick(t: DomainTemplate) {
    setChosen(t)
    setName(t.name)
    setStep('name')
  }

  async function create() {
    if (!chosen || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/knowledge-domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          name: name.trim(),
          templateId: chosen.id,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.domain?.id) {
        setError(data.error ?? 'Couldn\'t create the collection. Try again.')
        return
      }
      onCreated(data.domain.id)
    } finally { setBusy(false) }
  }

  return (
    <Modal title={step === 'pick' ? 'Pick a starting point' : 'Name your collection'} onClose={onClose} maxW="max-w-2xl">
      {step === 'pick' && (
        <>
          <p className="text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
            We&apos;ll seed your topic list to match. You can customise everything later.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {templates.map(t => (
              <button
                key={t.id}
                onClick={() => pick(t)}
                className="text-left p-4 rounded-xl border hover:bg-zinc-900/40 transition-colors"
                style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-start gap-3">
                  <div className="text-2xl">{t.icon}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t.name}</p>
                    <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>{t.description}</p>
                    {t.taxonomyCount > 0 && (
                      <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
                        Includes: {t.taxonomyPreview.join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
      {step === 'name' && chosen && (
        <>
          <div className="mb-4 flex items-center gap-3 p-3 rounded-lg" style={{ background: 'var(--surface-secondary)' }}>
            <div className="text-2xl">{chosen.icon}</div>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{chosen.name}</p>
              <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {chosen.taxonomyCount > 0
                  ? `${chosen.taxonomyCount} topics will be added automatically`
                  : 'Empty collection — you\'ll add topics manually'}
              </p>
            </div>
            <button onClick={() => setStep('pick')} className="ml-auto text-[11px] text-zinc-400 hover:text-zinc-200">Change</button>
          </div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Give this collection a name your team will recognise
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Acme Support Knowledge"
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
            autoFocus
          />
          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button onClick={onClose} className="text-xs px-3 py-1.5" style={{ color: 'var(--text-tertiary)' }}>Cancel</button>
            <button
              onClick={create}
              disabled={busy || !name.trim()}
              className="text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
              style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
            >
              {busy ? 'Creating…' : 'Create collection'}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

// ─── Add-source modal ───────────────────────────────────────────────────

function AddSourceModal({ sourceTypeCards, knowledgeDomainId, onClose, onCreated }: {
  sourceTypeCards: SourceTypeCard[]
  knowledgeDomainId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [step, setStep] = useState<'pick' | 'configure'>('pick')
  const [chosen, setChosen] = useState<SourceTypeCard | null>(null)
  const [identifier, setIdentifier] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function pick(card: SourceTypeCard) {
    if (!card.available) return
    setChosen(card)
    setStep('configure')
  }

  async function save() {
    if (!chosen || !identifier.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          knowledgeDomainId,
          sourceType: chosen.sourceType,
          urlOrIdentifier: identifier.trim(),
          crawlConfig: chosen.defaultConfig,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Couldn\'t save that source.'); return }
      onCreated()
    } finally { setBusy(false) }
  }

  return (
    <Modal title={step === 'pick' ? 'What do you want to connect?' : `Connect ${chosen?.name}`} onClose={onClose} maxW="max-w-2xl">
      {step === 'pick' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sourceTypeCards.map(c => (
            <button
              key={c.sourceType}
              onClick={() => pick(c)}
              disabled={!c.available}
              className="text-left p-4 rounded-xl border transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-900/40 disabled:hover:bg-transparent"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-start gap-3">
                <div className="text-2xl">{c.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{c.name}</p>
                    {!c.available && (
                      <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}>
                        Coming soon
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>{c.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      {step === 'configure' && chosen && (
        <>
          <div className="mb-4 flex items-center gap-3 p-3 rounded-lg" style={{ background: 'var(--surface-secondary)' }}>
            <div className="text-2xl">{chosen.icon}</div>
            <div className="flex-1">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{chosen.name}</p>
              <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{chosen.description}</p>
            </div>
            <button onClick={() => setStep('pick')} className="text-[11px] text-zinc-400 hover:text-zinc-200">Change</button>
          </div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>{chosen.identifierLabel}</label>
          <input
            value={identifier}
            onChange={e => setIdentifier(e.target.value)}
            placeholder={chosen.identifierPlaceholder}
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
            autoFocus
          />
          {chosen.identifierHint && (
            <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-tertiary)' }}>{chosen.identifierHint}</p>
          )}
          {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
          <div className="mt-4 flex items-center justify-end gap-2">
            <button onClick={onClose} className="text-xs px-3 py-1.5" style={{ color: 'var(--text-tertiary)' }}>Cancel</button>
            <button
              onClick={save}
              disabled={busy || !identifier.trim()}
              className="text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
              style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
            >
              {busy ? 'Adding…' : 'Add source'}
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

// ─── Run progress modal ─────────────────────────────────────────────────

function RunProgressModal({ runId, onClose }: { runId: string; onClose: (run: Run | null) => void }) {
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Capture the latest run object in a ref so onClose handlers (which
  // close over the initial value otherwise) can pass it up to the
  // parent — the parent decides whether to start background polling
  // based on status='running' vs terminal.
  const runRef = useRef<Run | null>(null)
  runRef.current = run

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      try {
        const res = await fetch(`/api/admin/ingestion-runs/${runId}`)
        if (!res.ok) {
          if (res.status === 404) setError('Run disappeared. Refresh the page.')
          return
        }
        const data = await res.json()
        if (cancelled) return
        setRun(data)
        if (data.status === 'running') timer = setTimeout(tick, 2000)
      } catch {
        if (!cancelled) setError('Lost connection. Will try again.')
        timer = setTimeout(tick, 4000)
      }
    }
    tick()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [runId])

  const isRunning = run?.status === 'running'
  const pct = run && run.pagesAttempted > 0
    ? Math.min(100, Math.round((run.pagesSucceeded / run.pagesAttempted) * 100))
    : isRunning ? 5 : 100

  // Wrapper that passes the latest run state up to the parent. The
  // parent uses status === 'running' to know whether to hand off to
  // background polling vs just refresh the lists and move on.
  const handleClose = () => onClose(runRef.current)

  return (
    <Modal title="Reading your content" onClose={handleClose} maxW="max-w-lg" dismissable>
      {!run ? (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Starting up…</p>
      ) : (
        <>
          <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>{stageMessage(run)}</p>
          <div className="h-2 rounded-full overflow-hidden mb-3" style={{ background: 'var(--surface-tertiary)' }}>
            <div
              className="h-full transition-all"
              style={{
                width: `${pct}%`,
                background: run.status === 'success' ? 'var(--accent-emerald)'
                          : run.status === 'partial' ? 'var(--accent-amber)'
                          : run.status === 'failed'  ? 'var(--accent-red)'
                          : 'var(--accent-primary)',
              }}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center mb-4">
            <Stat label="Pages found" value={run.pagesAttempted || '…'} />
            <Stat label="Read" value={run.pagesSucceeded} />
            <Stat label="New entries" value={run.chunksCreated} />
          </div>
          {run.chunksSuperseded > 0 && (
            <p className="text-[11px] mb-2" style={{ color: 'var(--text-tertiary)' }}>
              {run.chunksSuperseded} entries replaced with updated versions
            </p>
          )}
          {run.errorLog.length > 0 && (
            <details className="rounded-lg border p-3 text-xs"
              style={{ background: 'var(--surface-secondary)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
              <summary className="cursor-pointer">
                {run.errorLog.length} page{run.errorLog.length === 1 ? '' : 's'} couldn&apos;t be read
              </summary>
              <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
                {run.errorLog.map((e, i) => (
                  <div key={i} className="text-[10px]">
                    <p className="font-mono break-all" style={{ color: 'var(--text-tertiary)' }}>{e.url}</p>
                    <p style={{ color: 'var(--accent-red)' }}>{humanError(e.stage, e.message)}</p>
                    {/* Raw error for when the friendly version isn't
                        enough — operators escalating to support need
                        the literal string, not the mapped one. */}
                    <p className="font-mono text-[9px] mt-0.5 opacity-60 break-all" style={{ color: 'var(--text-muted)' }}>
                      {e.stage}: {e.message.slice(0, 240)}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          )}
          {error && <p className="text-xs text-amber-400 mt-2">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            {isRunning ? (
              <button
                onClick={handleClose}
                className="text-sm font-medium px-4 py-2 rounded-lg border"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                title="Close this window — ingestion keeps running in the background. A pill at the bottom-right lets you re-open."
              >
                Continue in background
              </button>
            ) : (
              <button
                onClick={handleClose}
                className="text-sm font-semibold px-4 py-2 rounded-lg"
                style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
              >
                Done
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  )
}

// ─── Tabs ───────────────────────────────────────────────────────────────

function SourcesTab({ sources, runs, onAdd, onRun, onWatchRun, onChanged }: {
  sources: Source[]
  runs: Run[]
  onAdd: () => void
  onRun: (id: string) => void
  onWatchRun: (id: string) => void
  onChanged: () => Promise<void>
}) {
  const runningForSource = useMemo(() => {
    const m = new Map<string, Run>()
    for (const r of runs) {
      if (r.status === 'running' && !m.has(r.sourceId)) m.set(r.sourceId, r)
    }
    return m
  }, [runs])

  if (sources.length === 0) {
    return (
      <div className="rounded-2xl border p-8 text-center" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="text-3xl mb-2">📥</div>
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Connect your first source</p>
        <p className="text-xs mb-4 max-w-sm mx-auto" style={{ color: 'var(--text-tertiary)' }}>
          Pick a help center URL or upload a PDF. We&apos;ll read it, index it, and check back automatically for changes.
        </p>
        <button
          onClick={onAdd}
          className="text-sm font-semibold px-5 py-2 rounded-lg"
          style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
        >
          + Add a source
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Sources</h2>
        <button
          onClick={onAdd}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg"
          style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
        >
          + Add source
        </button>
      </div>
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        {sources.map(s => {
          const running = runningForSource.get(s.id)
          return (
            <SourceRow
              key={s.id}
              source={s}
              running={running ?? null}
              onRun={onRun}
              onWatchRun={onWatchRun}
              onChanged={onChanged}
            />
          )
        })}
      </div>
      <p className="text-[11px] mt-3" style={{ color: 'var(--text-tertiary)' }}>
        Re-reads run automatically each night for any source that&apos;s past its cadence. &ldquo;Read now&rdquo; jumps the queue.
      </p>
    </>
  )
}

function SourceRow({ source, running, onRun, onWatchRun, onChanged }: {
  source: Source
  running: Run | null
  onRun: (id: string) => void
  onWatchRun: (id: string) => void
  onChanged: () => Promise<void>
}) {
  const currentCadence = Number(source.crawlConfig?.recrawlIntervalDays) || 7
  const [busy, setBusy] = useState(false)
  // Optimistic local copy of cadence — updates the dropdown instantly,
  // then reconciles when the parent reloads sources.
  const [localCadence, setLocalCadence] = useState(currentCadence)

  async function updateCadence(days: number) {
    setBusy(true)
    setLocalCadence(days)
    try {
      const res = await fetch(`/api/admin/sources/${source.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recrawlIntervalDays: days }),
      })
      if (!res.ok) {
        setLocalCadence(currentCadence)
        const data = await res.json().catch(() => ({}))
        alert(data.error ?? 'Failed to update re-read frequency.')
        return
      }
      await onChanged()
    } finally { setBusy(false) }
  }

  // "When will this re-read next?" shown alongside the cadence so
  // operators don't have to do the math.
  const nextDueLabel = source.lastCrawledAt
    ? (() => {
        const nextMs = new Date(source.lastCrawledAt!).getTime() + localCadence * 24 * 60 * 60 * 1000
        const diff = nextMs - Date.now()
        if (diff <= 0) return 'queued for next sweep'
        const days = Math.ceil(diff / (24 * 60 * 60 * 1000))
        return `next in ~${days} day${days === 1 ? '' : 's'}`
      })()
    : 'will run on next sweep'

  return (
    <div className="p-4 border-t first:border-t-0 flex items-center gap-3" style={{ borderColor: 'var(--border)' }}>
      <span className="text-xl flex-shrink-0">{sourceIcon(source.sourceType)}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{source.urlOrIdentifier}</p>
        <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          {source.liveChunks} {source.liveChunks === 1 ? 'entry' : 'entries'} indexed · {source.lastCrawledAt ? `last read ${timeAgo(source.lastCrawledAt)}` : 'awaiting first read'}
        </p>
        <p className="text-[10px] mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--text-tertiary)' }}>
          <span>Re-read every</span>
          <select
            value={localCadence}
            disabled={busy}
            onChange={e => updateCadence(Number(e.target.value))}
            className="text-[10px] rounded px-1.5 py-0.5"
            style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
          >
            <option value={1}>1 day</option>
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
          <span>· {nextDueLabel}</span>
        </p>
      </div>
      {running ? (
        <button
          onClick={() => onWatchRun(running.id)}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5"
          style={{ background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }}
        >
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--accent-amber)' }} />
          Reading…
        </button>
      ) : (
        <button
          onClick={() => onRun(source.id)}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg"
          style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
        >
          Read now
        </button>
      )}
    </div>
  )
}

interface TopicSuggestion {
  key: string
  label: string
  description: string
  coversChunkIds: string[]
  sampleChunks: Array<{ id: string; primaryTopic: string | null; preview: string }>
}

function TaxonomyTab({ taxonomies, unmatched, domainId, onChange }: {
  taxonomies: Taxonomy[]
  unmatched: UnmatchedChunk[]
  domainId: string
  onChange: () => Promise<void>
}) {
  const [addingTopic, setAddingTopic] = useState(false)
  const [topicLabel, setTopicLabel] = useState('')
  const [busy, setBusy] = useState(false)
  // Multi-select state. When `selected` is non-empty, the per-row
  // assign dropdown is replaced by a sticky action bar that lets the
  // operator pick one topic for everything ticked.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkKey, setBulkKey] = useState<string>('')
  // Suggestion flow. Three states: idle, loading, list ready.
  const [suggesting, setSuggesting] = useState(false)
  const [suggestions, setSuggestions] = useState<TopicSuggestion[] | null>(null)

  async function createTopic() {
    if (!topicLabel.trim()) return
    setBusy(true)
    try {
      const key = topicLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60)
      const res = await fetch('/api/admin/taxonomies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ knowledgeDomainId: domainId, key, label: topicLabel.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? 'Failed'); return }
      setTopicLabel('')
      setAddingTopic(false)
      await onChange()
    } finally { setBusy(false) }
  }

  async function assignToChunk(chunkId: string, taxonomyKey: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/chunks/${chunkId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxonomyTags: [taxonomyKey] }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error ?? 'Failed to assign topic')
        return
      }
      await onChange()
    } finally { setBusy(false) }
  }

  async function bulkAssign() {
    if (selected.size === 0 || !bulkKey) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/chunks/bulk-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chunkIds: Array.from(selected), taxonomyKey: bulkKey }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? 'Bulk assign failed'); return }
      setSelected(new Set())
      setBulkKey('')
      await onChange()
    } finally { setBusy(false) }
  }

  async function runSuggest() {
    setSuggesting(true)
    setSuggestions(null)
    try {
      const res = await fetch('/api/admin/taxonomies/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ knowledgeDomainId: domainId }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error ?? 'Suggestion failed')
        return
      }
      setSuggestions(data.suggestions ?? [])
    } finally { setSuggesting(false) }
  }

  // Accept a suggestion: creates the taxonomy row, then bulk-assigns
  // every covered chunk to the new key. The operator sees the topic
  // appear in the list + the orphan count drop in one click.
  async function acceptSuggestion(s: TopicSuggestion) {
    setBusy(true)
    try {
      const createRes = await fetch('/api/admin/taxonomies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ knowledgeDomainId: domainId, key: s.key, label: s.label }),
      })
      const createData = await createRes.json()
      if (!createRes.ok && createRes.status !== 409) {
        alert(createData.error ?? 'Failed to create topic')
        return
      }
      // 409 means a topic with this key already exists — still apply.
      const bulkRes = await fetch('/api/admin/chunks/bulk-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chunkIds: s.coversChunkIds, taxonomyKey: s.key }),
      })
      if (!bulkRes.ok) {
        const data = await bulkRes.json().catch(() => ({}))
        alert(data.error ?? 'Topic created but bulk-tag failed')
        return
      }
      setSuggestions(prev => (prev ?? []).filter(p => p.key !== s.key))
      await onChange()
    } finally { setBusy(false) }
  }

  const toggleSelected = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const selectAllVisible = () => {
    setSelected(new Set(unmatched.slice(0, 30).map(c => c.id)))
  }
  const clearSelection = () => setSelected(new Set())

  return (
    <>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Topics</h2>
        <button
          onClick={() => setAddingTopic(true)}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg"
          style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
        >
          + New topic
        </button>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
        Every piece of content gets tagged with a topic so retrieval stays sharp. These were seeded from your template — add more when the &ldquo;Needs a topic&rdquo; list below shows a pattern.
      </p>

      {addingTopic && (
        <div className="rounded-lg border p-3 mb-3 flex items-center gap-2"
          style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)' }}>
          <input
            value={topicLabel}
            onChange={e => setTopicLabel(e.target.value)}
            placeholder="Topic name (e.g. Refund Policy)"
            className="flex-1 rounded px-2 py-1.5 text-sm"
            style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
            autoFocus
            onKeyDown={e => { if (e.key === 'Enter') createTopic() }}
          />
          <button
            onClick={createTopic}
            disabled={busy || !topicLabel.trim()}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
            style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
          >Save</button>
          <button
            onClick={() => { setAddingTopic(false); setTopicLabel('') }}
            className="text-xs px-2 py-1.5"
            style={{ color: 'var(--text-tertiary)' }}
          >Cancel</button>
        </div>
      )}

      <div className="rounded-xl border overflow-hidden mb-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        {taxonomies.length === 0 ? (
          <p className="p-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            No topics yet. Pick a template when creating a collection to get a starter set, or add one above.
          </p>
        ) : taxonomies.map(t => (
          <div key={t.id} className="p-3 border-t first:border-t-0 flex items-center gap-3" style={{ borderColor: 'var(--border)' }}>
            <span className="text-sm flex-1" style={{ color: 'var(--text-primary)' }}>{t.label}</span>
            {t.parentKey && <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>under {t.parentKey}</span>}
            {t.aliases.length > 0 && (
              <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                also: {t.aliases.slice(0, 3).join(', ')}
              </span>
            )}
          </div>
        ))}
      </div>

      {unmatched.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Needs a topic · {unmatched.length}</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={runSuggest}
                disabled={suggesting || busy}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
                style={{ background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)', border: '1px solid var(--accent-emerald)' }}
              >
                {suggesting ? 'Thinking…' : '✨ Suggest topics'}
              </button>
              {selected.size === 0
                ? <button onClick={selectAllVisible} className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Select all visible</button>
                : <button onClick={clearSelection} className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Clear ({selected.size})</button>
              }
            </div>
          </div>
          <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
            These entries didn&apos;t match any topic. Click <strong>Suggest topics</strong> to have the AI propose new topics that would cover several at once — or tick a few and bulk-assign manually.
            {taxonomies.length === 0 && ' Add some topics first using the button at the top.'}
          </p>

          {suggestions && suggestions.length > 0 && (
            <div className="mb-4 space-y-2">
              {suggestions.map(s => (
                <div key={s.key} className="rounded-lg p-3" style={{ background: 'var(--accent-emerald-bg)', border: '1px solid var(--accent-emerald)' }}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        ✨ {s.label} <span className="text-[10px] font-normal" style={{ color: 'var(--text-tertiary)' }}>({s.key})</span>
                      </p>
                      {s.description && (
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>{s.description}</p>
                      )}
                      <p className="text-[10px] mt-1" style={{ color: 'var(--accent-emerald)' }}>
                        Would cover {s.coversChunkIds.length} {s.coversChunkIds.length === 1 ? 'entry' : 'entries'}
                      </p>
                      {s.sampleChunks.length > 0 && (
                        <ul className="mt-2 space-y-0.5">
                          {s.sampleChunks.map(sc => (
                            <li key={sc.id} className="text-[10px] line-clamp-1" style={{ color: 'var(--text-tertiary)' }}>
                              · {sc.primaryTopic ? `${sc.primaryTopic} — ` : ''}{sc.preview}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => acceptSuggestion(s)}
                        disabled={busy}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
                        style={{ background: 'var(--accent-emerald)', color: 'white' }}
                      >
                        Accept &amp; tag
                      </button>
                      <button
                        onClick={() => setSuggestions(prev => (prev ?? []).filter(p => p.key !== s.key))}
                        className="text-[11px]"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {suggestions && suggestions.length === 0 && (
            <div className="mb-4 rounded-lg p-3 text-xs" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)', color: 'var(--text-tertiary)' }}>
              No clean suggestions came back — the unplaced entries are too varied to group. Try assigning a few manually first, then re-run.
            </div>
          )}

          {selected.size > 0 && taxonomies.length > 0 && (
            <div className="sticky top-2 z-10 mb-3 rounded-lg p-3 flex items-center gap-3 shadow-lg"
              style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}>
              <span className="text-xs font-semibold">{selected.size} selected</span>
              <select
                value={bulkKey}
                onChange={e => setBulkKey(e.target.value)}
                disabled={busy}
                className="text-xs rounded px-2 py-1 flex-1 max-w-[240px]"
                style={{ background: 'white', color: 'black' }}
              >
                <option value="">Pick a topic…</option>
                {taxonomies.map(t => (
                  <option key={t.id} value={t.key}>{t.label}</option>
                ))}
              </select>
              <button
                onClick={bulkAssign}
                disabled={busy || !bulkKey}
                className="text-xs font-semibold px-3 py-1 rounded disabled:opacity-50"
                style={{ background: 'white', color: 'var(--accent-primary)' }}
              >
                Assign to all
              </button>
              <button onClick={clearSelection} className="text-[11px] underline">Cancel</button>
            </div>
          )}

          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            {unmatched.slice(0, 30).map(c => {
              const checked = selected.has(c.id)
              return (
                <div key={c.id} className="p-3 border-t first:border-t-0 flex gap-3" style={{ borderColor: 'var(--border)', background: checked ? 'var(--accent-primary-bg)' : undefined }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSelected(c.id)}
                    className="mt-1 accent-orange-500 flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-primary)' }}>{c.primaryTopic || '(no topic)'}</p>
                    <p className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>{c.sourceUrl}</p>
                    <p className="text-xs mt-1 mb-2 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                      {c.content.slice(0, 240)}
                    </p>
                    {taxonomies.length > 0 && selected.size === 0 && (
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] uppercase tracking-wider font-semibold"
                          style={{ color: 'var(--text-tertiary)' }}>Assign topic:</label>
                        <select
                          defaultValue=""
                          onChange={e => {
                            const val = e.target.value
                            if (val) assignToChunk(c.id, val)
                          }}
                          disabled={busy}
                          className="text-xs rounded px-2 py-1"
                          style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
                        >
                          <option value="">Pick one…</option>
                          {taxonomies.map(t => (
                            <option key={t.id} value={t.key}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {unmatched.length > 30 && (
            <p className="text-[11px] mt-2" style={{ color: 'var(--text-tertiary)' }}>
              Showing the 30 most recent. Use <strong>Suggest topics</strong> to clear them in bulk — it considers up to 60 at a time.
            </p>
          )}
        </>
      )}
    </>
  )
}

function HistoryTab({ runs }: { runs: Run[] }) {
  if (runs.length === 0) {
    return (
      <p className="text-sm text-center py-10" style={{ color: 'var(--text-tertiary)' }}>
        No reads yet. Click &quot;Read now&quot; on a source to ingest content.
      </p>
    )
  }
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      {runs.map(r => (
        <details key={r.id} className="border-t first:border-t-0" style={{ borderColor: 'var(--border)' }}>
          <summary className="p-3 flex items-center gap-3 cursor-pointer hover:bg-zinc-900/40 transition-colors">
            <StatusPill status={r.status} />
            <span className="text-xs flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
              {sourceIcon(r.source.sourceType)} {r.source.urlOrIdentifier}
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              {r.pagesSucceeded}/{r.pagesAttempted} pages · {timeAgo(r.startedAt)}
            </span>
          </summary>
          {r.errorLog.length > 0 && (
            <div className="p-3" style={{ background: 'var(--surface-secondary)' }}>
              {r.errorLog.map((e, i) => (
                <div key={i} className="mb-2">
                  <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                    <span style={{ color: 'var(--accent-red)' }}>{humanError(e.stage, e.message)}</span> on {e.url}
                  </p>
                  <p className="font-mono text-[10px] mt-0.5 opacity-60 break-all" style={{ color: 'var(--text-muted)' }}>
                    {e.stage}: {e.message.slice(0, 240)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </details>
      ))}
    </div>
  )
}

// ─── Reusable bits ──────────────────────────────────────────────────────

function Modal({ children, title, onClose, maxW = 'max-w-md', dismissable = true }: {
  children: React.ReactNode
  title: string
  onClose: () => void
  maxW?: string
  dismissable?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={dismissable ? onClose : undefined}>
      <div
        className={`w-full ${maxW} rounded-xl overflow-hidden`}
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</p>
          {dismissable && (
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200" aria-label="Close">×</button>
          )}
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center max-w-md">{children}</div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="p-2 rounded-lg" style={{ background: 'var(--surface-secondary)' }}>
      <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
    </div>
  )
}

function StatusPill({ status }: { status: Run['status'] }) {
  const label = status === 'success' ? 'Done'
              : status === 'partial' ? 'Partial'
              : status === 'failed'  ? 'Failed'
              : 'Reading…'
  const bg = status === 'success' ? 'var(--accent-emerald-bg)'
           : status === 'partial' ? 'var(--accent-amber-bg)'
           : status === 'failed'  ? 'var(--accent-red-bg)'
           : 'var(--surface-secondary)'
  const fg = status === 'success' ? 'var(--accent-emerald)'
           : status === 'partial' ? 'var(--accent-amber)'
           : status === 'failed'  ? 'var(--accent-red)'
           : 'var(--text-tertiary)'
  return (
    <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded" style={{ background: bg, color: fg }}>
      {label}
    </span>
  )
}

function sourceIcon(t: string): string {
  switch (t) {
    case 'docs':      return '📚'
    case 'pdf':       return '📄'
    case 'youtube':   return '🎥'
    case 'rss':       return '📰'
    case 'community': return '💬'
    case 'manual':    return '✏️'
    default:          return '📦'
  }
}

function stageMessage(r: Run): string {
  if (r.status === 'success') return `All done — added ${r.chunksCreated} new ${r.chunksCreated === 1 ? 'entry' : 'entries'}.`
  if (r.status === 'partial') return `Finished with some errors — ${r.pagesSucceeded} of ${r.pagesAttempted} pages read successfully.`
  if (r.status === 'failed')  return 'Something went wrong. See details below.'
  if (r.pagesAttempted === 0) return 'Discovering pages…'
  return `Reading page ${r.pagesSucceeded + 1} of ${r.pagesAttempted}…`
}

function humanError(stage: string, message: string): string {
  // Missing / invalid API keys — most common first-run failure mode.
  // Distinguished BEFORE the generic Voyage / Firecrawl branches
  // below so the operator sees the actual root cause.
  if (/VOYAGE_API_KEY/i.test(message))     return 'Embedding service isn\'t configured — VOYAGE_API_KEY is missing from environment settings.'
  if (/FIRECRAWL_API_KEY/i.test(message))  return 'Crawler isn\'t configured — FIRECRAWL_API_KEY is missing from environment settings.'
  if (/Voyage 401|Voyage 403/i.test(message)) return 'Embedding service rejected our key — VOYAGE_API_KEY looks invalid or expired.'
  if (/Firecrawl 401|Firecrawl 403/i.test(message)) return 'Crawler rejected our key — FIRECRAWL_API_KEY looks invalid or expired.'
  if (/rate.?limit|429/i.test(message)) return 'Rate limit — we\'ll retry on the next scheduled read.'
  if (/timeout/i.test(message))         return 'The source took too long to respond.'
  if (/firecrawl/i.test(message))       return 'Couldn\'t fetch the page. The site may block crawlers.'
  if (/credit/i.test(message))          return 'Anthropic credit balance is empty — top up at console.anthropic.com.'
  if (/voyage/i.test(message))          return 'Embedding service is unreachable. Try again in a minute.'
  if (stage === 'fetch')    return 'Couldn\'t fetch this page.'
  if (stage === 'normalize') return 'This page couldn\'t be parsed (might be a scanned PDF or empty page).'
  if (stage === 'classify') return 'Classification step failed — chunk saved without tags.'
  if (stage === 'embed')    return 'Embedding step failed.'
  return message.slice(0, 120)
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
