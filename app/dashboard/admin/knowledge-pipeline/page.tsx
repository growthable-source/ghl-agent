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

import { useCallback, useEffect, useMemo, useState } from 'react'

interface Workspace { id: string; name: string }
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
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
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
  const [activeRunId, setActiveRunId] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetch('/api/workspaces').then(r => r.json()).catch(() => ({})),
      fetch('/api/admin/domain-templates').then(r => r.json()).catch(() => ({})),
    ]).then(([wsData, tplData]) => {
      const list: Workspace[] = (wsData.workspaces ?? []).map((w: any) => ({ id: w.id, name: w.name }))
      setWorkspaces(list)
      if (list.length) setWorkspaceId(list[0].id)
      setTemplates(tplData.domainTemplates ?? [])
      setSourceTypeCards(tplData.sourceTypeCards ?? [])
    })
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
          {workspaces.length > 1 && (
            <select
              value={workspaceId ?? ''}
              onChange={e => { setWorkspaceId(e.target.value); setDomainId(null) }}
              className="text-sm rounded-lg px-3 py-2"
              style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
            >
              {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          )}
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
                  />
                )}
                {tab === 'taxonomy' && (
                  <TaxonomyTab taxonomies={taxonomies} unmatched={unmatched} />
                )}
                {tab === 'history' && (
                  <HistoryTab runs={runs} />
                )}
              </>
            )}
          </>
        )}
      </div>

      {createDomainOpen && workspaceId && (
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
          onClose={async () => {
            setActiveRunId(null)
            await Promise.all([loadSources(), loadRuns(), loadDomains()])
          }}
        />
      )}
    </div>
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

function RunProgressModal({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [run, setRun] = useState<Run | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <Modal title="Reading your content" onClose={onClose} maxW="max-w-lg" dismissable={!isRunning}>
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
              <div className="mt-2 space-y-1.5 max-h-40 overflow-y-auto">
                {run.errorLog.map((e, i) => (
                  <div key={i} className="text-[10px]">
                    <p className="font-mono break-all" style={{ color: 'var(--text-tertiary)' }}>{e.url}</p>
                    <p style={{ color: 'var(--accent-red)' }}>{humanError(e.stage, e.message)}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
          {error && <p className="text-xs text-amber-400 mt-2">{error}</p>}
          {!isRunning && (
            <div className="mt-5 flex justify-end">
              <button
                onClick={onClose}
                className="text-sm font-semibold px-4 py-2 rounded-lg"
                style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
              >
                Done
              </button>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}

// ─── Tabs ───────────────────────────────────────────────────────────────

function SourcesTab({ sources, runs, onAdd, onRun, onWatchRun }: {
  sources: Source[]
  runs: Run[]
  onAdd: () => void
  onRun: (id: string) => void
  onWatchRun: (id: string) => void
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
            <div key={s.id} className="p-4 border-t first:border-t-0 flex items-center gap-3" style={{ borderColor: 'var(--border)' }}>
              <span className="text-xl flex-shrink-0">{sourceIcon(s.sourceType)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{s.urlOrIdentifier}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  {s.liveChunks} entries indexed · {s.lastCrawledAt ? `updated ${timeAgo(s.lastCrawledAt)}` : 'never read'}
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
                  onClick={() => onRun(s.id)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg"
                  style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
                >
                  Read now
                </button>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

function TaxonomyTab({ taxonomies, unmatched }: { taxonomies: Taxonomy[]; unmatched: UnmatchedChunk[] }) {
  return (
    <>
      <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Topics</h2>
      <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
        Every piece of content gets tagged with a topic so retrieval stays sharp. These were seeded from your template.
      </p>
      <div className="rounded-xl border overflow-hidden mb-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        {taxonomies.length === 0 ? (
          <p className="p-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            No topics yet. Pick a template when creating a collection to get a starter set.
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
          <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Needs a topic</h2>
          <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
            We couldn&apos;t fit these into your existing topics. Add new ones if you see a pattern.
          </p>
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            {unmatched.slice(0, 20).map(c => (
              <div key={c.id} className="p-3 border-t first:border-t-0" style={{ borderColor: 'var(--border)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{c.primaryTopic || '(no topic)'}</p>
                <p className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>{c.sourceUrl}</p>
                <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                  {c.content.slice(0, 200)}
                </p>
              </div>
            ))}
          </div>
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
                <p key={i} className="text-[11px] mb-1" style={{ color: 'var(--text-tertiary)' }}>
                  <span style={{ color: 'var(--accent-red)' }}>{humanError(e.stage, e.message)}</span> on {e.url}
                </p>
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
