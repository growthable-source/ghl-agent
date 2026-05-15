'use client'

/**
 * Retrieval eval harness — operator UI.
 *
 * Flow:
 *   1. No eval set → big "Create your first eval set" card
 *   2. Pick / create a set → list queries, add new ones via form,
 *      see the most recent run summary card with net@K + coverage
 *   3. Click "Run eval" → async kick-off + progress polling
 *   4. Click a run → labeling pane: per-query chunks with
 *      helpful/neutral/harmful buttons. Scores roll up as you label.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'

interface EvalSet {
  id: string
  name: string
  description: string | null
  queryCount: number
  runCount: number
  lastRun: {
    id: string
    status: 'running' | 'success' | 'failed'
    startedAt: string
    completedAt: string | null
    summary: any
  } | null
}

interface EvalQuery {
  id: string
  query: string
  expectedAnswer: string
  brand: { id: string; name: string; slug: string } | null
  intentTags: string[]
}

interface RetrievedChunkSnap {
  rank: number
  chunkId: string
  content: string
  sourceUrl: string
  primaryTopic: string | null
  similarity: number
}
interface LabelEntry {
  label: 'helpful' | 'neutral' | 'harmful'
  reason: string | null
  labeledBy: string
  labeledAt: string
}
interface EvalResult {
  id: string
  query: EvalQuery
  retrievedChunks: RetrievedChunkSnap[]
  labels: Record<string, LabelEntry>
  netAtK: number | null
  coverageAtK: number | null
}
interface EvalRun {
  id: string
  evalSetId: string
  evalSetName: string
  startedAt: string
  completedAt: string | null
  status: 'running' | 'success' | 'failed'
  config: any
  rubricVersion: string | null
  summary: any
  results: EvalResult[]
}

export default function RetrievalEvalPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [sets, setSets] = useState<EvalSet[]>([])
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null)
  const [setDetail, setSetDetail] = useState<{ queries: EvalQuery[]; runs: Array<{ id: string; startedAt: string; status: string; summary: any }> } | null>(null)
  const [loading, setLoading] = useState(true)
  const [notMigrated, setNotMigrated] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadSets = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/retrieval-evals/sets?workspaceId=${workspaceId}`)
      const data = await res.json()
      setSets(data.sets ?? [])
      setNotMigrated(!!data.notMigrated)
      if (!selectedSetId && data.sets?.[0]) setSelectedSetId(data.sets[0].id)
    } finally { setLoading(false) }
  }, [workspaceId, selectedSetId])

  const loadSetDetail = useCallback(async () => {
    if (!selectedSetId) { setSetDetail(null); return }
    const res = await fetch(`/api/admin/retrieval-evals/sets/${selectedSetId}`)
    const data = await res.json()
    if (data?.set) {
      setSetDetail({ queries: data.set.queries ?? [], runs: data.set.runs ?? [] })
    }
  }, [selectedSetId])

  useEffect(() => { loadSets() }, [loadSets])
  useEffect(() => { loadSetDetail() }, [loadSetDetail])

  async function runEval() {
    if (!selectedSetId) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/retrieval-evals/sets/${selectedSetId}/run`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.runId) {
        alert(data.error ?? 'Couldn\'t start the eval.')
        return
      }
      setActiveRunId(data.runId)
    } finally { setBusy(false) }
  }

  if (notMigrated) {
    return (
      <Centered>
        <div className="text-3xl mb-3">⚙️</div>
        <h1 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Eval harness pending setup</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          The retrieval eval tables aren&apos;t in this database yet. Drop us a note — it&apos;s a one-time migration we run from our side.
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
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Test your AI&apos;s knowledge</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Type a few questions your customers ask. We&apos;ll show what your AI finds. Mark each result good or bad, and we&apos;ll tell you how it&apos;s doing.
            </p>
          </div>
        </div>

        {sets.length === 0 ? (
          <EmptyState onCreate={() => setCreateOpen(true)} />
        ) : (
          <>
            {/* Set switcher */}
            <div className="mb-4 flex items-center gap-2 flex-wrap">
              {sets.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSetId(s.id)}
                  className="text-xs font-medium px-3 py-1.5 rounded-full border transition-colors"
                  style={selectedSetId === s.id
                    ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' }
                    : { background: 'var(--surface)', color: 'var(--text-tertiary)', borderColor: 'var(--border)' }}
                >
                  {s.name} <span className="opacity-70">· {s.queryCount}</span>
                </button>
              ))}
              <button
                onClick={() => setCreateOpen(true)}
                className="text-xs font-medium px-3 py-1.5 rounded-full border border-dashed hover:bg-zinc-900 transition-colors"
                style={{ color: 'var(--text-tertiary)', borderColor: 'var(--border)' }}
              >
                + New set
              </button>
            </div>

            {selectedSetId && (() => {
              const set = sets.find(s => s.id === selectedSetId)!
              return (
                <>
                  {/* Last-run summary card */}
                  <SummaryCard set={set} onWatchRun={setActiveRunId} />

                  {/* Queries + run-now */}
                  <div className="mt-6 flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Test questions · {setDetail?.queries.length ?? 0}</h2>
                    <button
                      onClick={runEval}
                      disabled={busy || (setDetail?.queries.length ?? 0) === 0}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
                      style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
                    >
                      {busy ? 'Starting…' : 'Run the test'}
                    </button>
                  </div>
                  <QueriesList
                    setId={selectedSetId}
                    queries={setDetail?.queries ?? []}
                    workspaceId={workspaceId}
                    onChange={async () => { await loadSetDetail(); await loadSets() }}
                  />

                  {/* Past tests */}
                  {setDetail && setDetail.runs.length > 0 && (
                    <div className="mt-6">
                      <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Past tests</h2>
                      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                        {setDetail.runs.map(r => (
                          <button
                            key={r.id}
                            onClick={() => setActiveRunId(r.id)}
                            className="w-full text-left p-3 border-t first:border-t-0 flex items-center gap-3 hover:bg-zinc-900/40 transition-colors"
                            style={{ borderColor: 'var(--border)' }}
                          >
                            <StatusPill status={r.status as any} />
                            <span className="text-xs flex-1" style={{ color: 'var(--text-primary)' }}>
                              {timeAgo(r.startedAt)}
                            </span>
                            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                              Score {r.summary?.netAtK !== null && r.summary?.netAtK !== undefined ? `${Math.round(Math.max(0, r.summary.netAtK) * 100)}%` : '—'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )
            })()}
          </>
        )}
      </div>

      {createOpen && (
        <CreateSetModal
          workspaceId={workspaceId}
          onClose={() => setCreateOpen(false)}
          onCreated={async (id) => {
            setCreateOpen(false)
            await loadSets()
            setSelectedSetId(id)
          }}
        />
      )}

      {activeRunId && (
        <RunPane
          runId={activeRunId}
          onClose={async () => {
            setActiveRunId(null)
            await loadSets()
            await loadSetDetail()
          }}
        />
      )}
    </div>
  )
}

// ─── Empty state ────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl border p-8 text-center" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      <div className="text-4xl mb-3">🎯</div>
      <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>How well does your AI know its stuff?</h2>
      <p className="text-sm max-w-md mx-auto mb-6" style={{ color: 'var(--text-secondary)' }}>
        Write a few real questions your customers ask. Press <strong>Test</strong>. We&apos;ll show you what your AI would find — you mark each result good or bad. Run it again any time to spot regressions.
      </p>
      <button
        onClick={onCreate}
        className="text-sm font-semibold px-6 py-2.5 rounded-lg"
        style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
      >
        Start
      </button>
    </div>
  )
}

// ─── Summary card ───────────────────────────────────────────────────────

function SummaryCard({ set, onWatchRun }: { set: EvalSet; onWatchRun: (id: string) => void }) {
  if (!set.lastRun) {
    return (
      <div className="rounded-xl border p-5" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          No runs yet. Add some questions and hit &quot;Run the test&quot; below.
        </p>
      </div>
    )
  }
  const summary = set.lastRun.summary ?? {}
  const netAtK = summary.netAtK
  const coverageAtK = summary.coverageAtK
  const labelled = summary.labelledQueries ?? 0
  const total = summary.totalQueries ?? 0
  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>Latest run</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {timeAgo(set.lastRun.startedAt)} · {set.lastRun.status}
          </p>
        </div>
        <button
          onClick={() => onWatchRun(set.lastRun!.id)}
          className="text-xs font-medium px-3 py-1.5 rounded-lg border"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          {labelled < total ? `Label ${total - labelled} pending` : 'View results'}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Score" value={netAtK !== null && netAtK !== undefined ? `${Math.round(Math.max(0, netAtK) * 100)}%` : '—'} />
        <Stat label="On target" value={coverageAtK !== null && coverageAtK !== undefined ? `${Math.round(coverageAtK * 100)}%` : '—'} />
        <Stat label="Reviewed" value={`${labelled} / ${total}`} />
      </div>
      {/* Per-brand breakdown */}
      {summary.perBrand && Object.keys(summary.perBrand).length > 1 && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--text-tertiary)' }}>Per brand</p>
          <div className="space-y-1">
            {Object.entries(summary.perBrand).map(([key, val]: [string, any]) => (
              <div key={key} className="text-[11px] flex justify-between" style={{ color: 'var(--text-secondary)' }}>
                <span>{key === '_workspace' ? '(workspace-wide)' : key}</span>
                <span>score {val.netAtK !== null ? `${Math.round(Math.max(0, val.netAtK) * 100)}%` : '—'} · {val.labelled}/{val.total} reviewed</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Queries list (+ add form) ──────────────────────────────────────────

function QueriesList({ setId, queries, workspaceId, onChange }: {
  setId: string
  queries: EvalQuery[]
  workspaceId: string
  onChange: () => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [expected, setExpected] = useState('')
  const [brandId, setBrandId] = useState('')
  const [brands, setBrands] = useState<Array<{ id: string; name: string }>>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/brands`)
      .then(r => r.json())
      .then(d => setBrands(d.brands ?? []))
      .catch(() => {})
  }, [workspaceId])

  async function add() {
    if (!query.trim() || !expected.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/retrieval-evals/sets/${setId}/queries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          expectedAnswer: expected.trim(),
          brandId: brandId || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error ?? 'Failed to add'); return }
      setQuery('')
      setExpected('')
      setBrandId('')
      setAdding(false)
      await onChange()
    } finally { setBusy(false) }
  }

  async function remove(queryId: string) {
    if (!confirm('Remove this query?')) return
    setBusy(true)
    try {
      await fetch(`/api/admin/retrieval-evals/sets/${setId}/queries`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queryId }),
      })
      await onChange()
    } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      {queries.map(q => (
        <div key={q.id} className="p-3 border-t first:border-t-0" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{q.query}</p>
              <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>
                Expected: {q.expectedAnswer}
              </p>
              {q.brand && (
                <span className="inline-block mt-1.5 text-[10px] px-1.5 py-0.5 rounded"
                  style={{ background: 'var(--surface-secondary)', color: 'var(--text-secondary)' }}>
                  brand: {q.brand.name}
                </span>
              )}
            </div>
            <button
              onClick={() => remove(q.id)}
              className="text-[11px] text-red-400 hover:text-red-300"
              disabled={busy}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      {adding ? (
        <div className="p-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="What would a visitor ask? (e.g. How do I cancel my subscription?)"
            className="w-full rounded-lg px-3 py-2 text-sm mb-2"
            style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
            autoFocus
          />
          <textarea
            value={expected}
            onChange={e => setExpected(e.target.value)}
            placeholder="What does a good answer reference? (e.g. The Billing page → Cancel button → confirmation modal.)"
            rows={3}
            className="w-full rounded-lg px-3 py-2 text-sm mb-2"
            style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
          />
          {brands.length > 0 && (
            <select
              value={brandId}
              onChange={e => setBrandId(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm mb-2"
              style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
            >
              <option value="">— No brand scope (workspace-wide query)</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="text-xs px-3 py-1.5" style={{ color: 'var(--text-tertiary)' }}>
              Cancel
            </button>
            <button
              onClick={add}
              disabled={busy || !query.trim() || !expected.trim()}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
              style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
            >
              {busy ? 'Adding…' : 'Add query'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full p-3 border-t text-left text-xs hover:bg-zinc-900/40 transition-colors"
          style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
        >
          + Add a query
        </button>
      )}
    </div>
  )
}

// ─── Run pane (labelling UI + progress polling) ─────────────────────────

function RunPane({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [run, setRun] = useState<EvalRun | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      try {
        const res = await fetch(`/api/admin/retrieval-evals/runs/${runId}`)
        if (!res.ok) {
          if (res.status === 404) setError('Run not found.')
          return
        }
        const data = await res.json()
        if (cancelled) return
        setRun(data)
        if (data.status === 'running') {
          timer = setTimeout(tick, 2000)
        }
      } catch {
        if (!cancelled) setError('Lost connection. Will retry.')
        timer = setTimeout(tick, 4000)
      }
    }
    tick()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [runId])

  async function setLabel(resultId: string, chunkId: string, label: 'helpful' | 'neutral' | 'harmful' | null) {
    const res = await fetch(`/api/admin/retrieval-evals/results/${resultId}/labels`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunkId, label }),
    })
    const data = await res.json()
    if (!res.ok) { alert(data.error ?? 'Failed'); return }
    // Refresh just this result locally
    setRun(prev => {
      if (!prev) return prev
      return {
        ...prev,
        results: prev.results.map(r =>
          r.id === resultId
            ? { ...r, labels: data.labels ?? {}, netAtK: data.netAtK, coverageAtK: data.coverageAtK }
            : r,
        ),
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-stretch justify-stretch p-0 md:p-6" onClick={onClose}>
      <div
        className="w-full md:max-w-5xl mx-auto rounded-xl overflow-hidden flex flex-col"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Eval run · {run?.evalSetName ?? '…'}
            </p>
            {run && (
              <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                {timeAgo(run.startedAt)} · rubric {run.rubricVersion ?? 'unset'}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg" aria-label="Close">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {!run ? (
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p>
          ) : run.status === 'running' ? (
            <div className="text-center py-12">
              <div className="inline-block w-8 h-8 border-2 border-orange-500/30 border-t-orange-500 rounded-full animate-spin mb-3" />
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Running queries against your knowledge base…
              </p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                {run.results.length} of {run.results.length} processed so far
              </p>
            </div>
          ) : (
            <>
              {/* Roll-up summary */}
              <div className="rounded-lg border p-4 mb-5" style={{ background: 'var(--surface-secondary)', borderColor: 'var(--border)' }}>
                <div className="grid grid-cols-3 gap-3 mb-2">
                  <Stat label="Score" value={run.summary?.netAtK !== null && run.summary?.netAtK !== undefined ? `${Math.round(Math.max(0, run.summary.netAtK) * 100)}%` : '—'} />
                  <Stat label="On target" value={run.summary?.coverageAtK !== null && run.summary?.coverageAtK !== undefined ? `${Math.round(run.summary.coverageAtK * 100)}%` : '—'} />
                  <Stat label="Reviewed" value={`${run.summary?.labelledQueries ?? 0} / ${run.summary?.totalQueries ?? 0}`} />
                </div>
                <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                  For each result below, tap <strong>👍 Good</strong> if it would help answer the question, <strong>➖ Okay</strong> if it&apos;s correct but unhelpful, <strong>👎 Wrong</strong> if it&apos;s off-topic or misleading. Your score updates as you go.
                </p>
              </div>

              {/* Per-query results */}
              <div className="space-y-6">
                {run.results.map(r => (
                  <ResultBlock key={r.id} result={r} onLabel={setLabel} />
                ))}
              </div>
            </>
          )}
          {error && <p className="text-xs text-amber-400 mt-3">{error}</p>}
        </div>
      </div>
    </div>
  )
}

function ResultBlock({ result, onLabel }: {
  result: EvalResult
  onLabel: (resultId: string, chunkId: string, label: 'helpful' | 'neutral' | 'harmful' | null) => Promise<void>
}) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{result.query.query}</p>
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
        Expected: {result.query.expectedAnswer}
      </p>

      {result.retrievedChunks.length === 0 ? (
        <p className="text-xs italic" style={{ color: 'var(--text-tertiary)' }}>
          No chunks retrieved above the similarity floor for this query.
        </p>
      ) : (
        <div className="space-y-2">
          {result.retrievedChunks.map(chunk => {
            const lbl = result.labels[chunk.chunkId]?.label
            return (
              <div key={chunk.chunkId} className="rounded-lg border p-3"
                style={{
                  borderColor: lbl === 'helpful' ? 'var(--accent-emerald)'
                             : lbl === 'harmful' ? 'var(--accent-red)'
                             : 'var(--border)',
                  background: 'var(--surface-secondary)',
                }}>
                <div className="flex items-start gap-3 mb-2">
                  <span className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                    [{chunk.rank + 1}] {chunk.similarity.toFixed(2)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                      {chunk.primaryTopic ?? '(untitled)'}
                    </p>
                    <p className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>{chunk.sourceUrl}</p>
                  </div>
                </div>
                <p className="text-xs whitespace-pre-wrap line-clamp-4" style={{ color: 'var(--text-secondary)' }}>
                  {chunk.content}
                </p>
                <div className="flex items-center gap-1.5 mt-2">
                  {([
                    { id: 'helpful',  emoji: '👍', text: 'Good' },
                    { id: 'neutral',  emoji: '➖', text: 'Okay' },
                    { id: 'harmful',  emoji: '👎', text: 'Wrong' },
                  ] as const).map(opt => {
                    const isActive = lbl === opt.id
                    return (
                      <button
                        key={opt.id}
                        onClick={() => onLabel(result.id, chunk.chunkId, isActive ? null : opt.id as any)}
                        className="text-[11px] font-semibold px-2.5 py-1 rounded transition-colors"
                        style={isActive
                          ? {
                              background: opt.id === 'helpful' ? 'var(--accent-emerald-bg)'
                                        : opt.id === 'harmful' ? 'var(--accent-red-bg)'
                                        : 'var(--surface-tertiary)',
                              color: opt.id === 'helpful' ? 'var(--accent-emerald)'
                                   : opt.id === 'harmful' ? 'var(--accent-red)'
                                   : 'var(--text-secondary)',
                            }
                          : { color: 'var(--text-tertiary)' }}
                      >
                        {opt.emoji} {opt.text}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Create-set modal ───────────────────────────────────────────────────

function CreateSetModal({ workspaceId, onClose, onCreated }: {
  workspaceId: string
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/retrieval-evals/sets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, name: name.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed'); return }
      onCreated(data.set.id)
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Name your eval set</p>
        </div>
        <div className="p-5">
          <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
            Something your team will recognise — e.g. &quot;Support FAQs&quot;, &quot;Pricing questions&quot;.
          </p>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Eval set name"
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
              className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
              style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
            >
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Bits ──────────────────────────────────────────────────────────────

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

function StatusPill({ status }: { status: 'running' | 'success' | 'failed' }) {
  const label = status === 'success' ? 'Done' : status === 'failed' ? 'Failed' : 'Running…'
  const bg = status === 'success' ? 'var(--accent-emerald-bg)'
           : status === 'failed'  ? 'var(--accent-red-bg)'
           : 'var(--surface-secondary)'
  const fg = status === 'success' ? 'var(--accent-emerald)'
           : status === 'failed'  ? 'var(--accent-red)'
           : 'var(--text-tertiary)'
  return (
    <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded" style={{ background: bg, color: fg }}>{label}</span>
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
