'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface ExperimentStats {
  exposures: { A: number; B: number }
  conversions: { A: number; B: number }
  rateA: number
  rateB: number
  liftPct: number
}

interface Experiment {
  id: string
  hypothesis: string
  variantALabel: string
  variantBLabel: string
  variantAPrompt: string | null
  variantBPrompt: string
  metric: string
  splitPercent: number
  status: 'draft' | 'approved' | 'running' | 'ended' | 'rejected'
  proposedBy: string | null
  proposedAt: string
  startedAt: string | null
  endedAt: string | null
  stats: ExperimentStats | null
}

const STATUS_BADGE: Record<string, { color: string; label: string }> = {
  draft:    { color: 'bg-zinc-700 text-zinc-200', label: 'Draft' },
  approved: { color: 'bg-blue-500/20 text-blue-300', label: 'Approved' },
  running:  { color: 'bg-emerald-500/20 text-emerald-300', label: 'Running' },
  ended:    { color: 'bg-zinc-800 text-zinc-400', label: 'Ended' },
  rejected: { color: 'bg-red-500/15 text-red-300', label: 'Rejected' },
}

export default function ExperimentsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [experiments, setExperiments] = useState<Experiment[]>([])
  const [loading, setLoading] = useState(true)
  const [notMigrated, setNotMigrated] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/experiments`)
    const data = await res.json()
    setExperiments(data.experiments || [])
    setNotMigrated(!!data.notMigrated)
    setLoading(false)
  }, [workspaceId, agentId])

  useEffect(() => { refresh() }, [refresh])

  if (loading) return <div className="p-8"><div className="h-6 w-48 bg-zinc-800 rounded animate-pulse" /></div>

  const drafts = experiments.filter(e => e.status === 'draft')
  const running = experiments.filter(e => e.status === 'running' || e.status === 'approved')
  const decided = experiments.filter(e => e.status === 'ended' || e.status === 'rejected')

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Experiments</h1>
          <p className="text-sm text-zinc-400 mt-1 max-w-2xl">
            A/B test different opening lines, personas, or appended instructions on a slice of inbounds.
            The agent self-proposes hypotheses weekly — you approve which ones run.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-colors"
          style={{ background: '#fa4d2e' }}
        >
          + New experiment
        </button>
      </div>

      {notMigrated && (
        <div className="p-4 mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5 text-sm text-amber-300">
          Run manual_agent_experiments.sql to enable experiments.
        </div>
      )}

      {experiments.length === 0 && !notMigrated ? (
        <div className="text-center py-16 border border-dashed border-zinc-700 rounded-xl">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">🧪</div>
          <p className="text-sm font-medium text-white mb-1">No experiments yet</p>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto">
            The weekly proposer will draft a candidate experiment for this agent every Monday once it has 30+ inbounds in the last 7 days. Or create one manually.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {drafts.length > 0 && (
            <Section title="Drafts — review and approve" experiments={drafts} workspaceId={workspaceId} agentId={agentId} onChange={refresh} />
          )}
          {running.length > 0 && (
            <Section title="Running" experiments={running} workspaceId={workspaceId} agentId={agentId} onChange={refresh} />
          )}
          {decided.length > 0 && (
            <Section title="Ended" experiments={decided} workspaceId={workspaceId} agentId={agentId} onChange={refresh} />
          )}
        </div>
      )}

      {createOpen && (
        <CreateModal
          workspaceId={workspaceId}
          agentId={agentId}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => { setCreateOpen(false); await refresh() }}
        />
      )}
    </div>
  )
}

function Section({
  title, experiments, workspaceId, agentId, onChange,
}: {
  title: string
  experiments: Experiment[]
  workspaceId: string
  agentId: string
  onChange: () => Promise<void>
}) {
  return (
    <div>
      <h2 className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">{title}</h2>
      <div className="space-y-3">
        {experiments.map(e => (
          <ExperimentCard key={e.id} exp={e} workspaceId={workspaceId} agentId={agentId} onChange={onChange} />
        ))}
      </div>
    </div>
  )
}

function ExperimentCard({
  exp, workspaceId, agentId, onChange,
}: {
  exp: Experiment
  workspaceId: string
  agentId: string
  onChange: () => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const badge = STATUS_BADGE[exp.status] || STATUS_BADGE.draft

  const [error, setError] = useState<string | null>(null)
  async function patch(body: Record<string, unknown>, label: string) {
    setBusy(label)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/experiments/${exp.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || `Update failed (HTTP ${res.status})`)
        return
      }
      await onChange()
    } catch (err: any) {
      setError(err?.message || 'Network error')
    } finally { setBusy(null) }
  }

  async function remove() {
    if (!confirm('Delete this experiment? This also removes its exposure/conversion events.')) return
    setBusy('delete')
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/experiments/${exp.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || `Delete failed (HTTP ${res.status})`)
        return
      }
      await onChange()
    } catch (err: any) {
      setError(err?.message || 'Network error')
    } finally { setBusy(null) }
  }

  const stats = exp.stats
  const significant = stats && (stats.exposures.A + stats.exposures.B) >= 50

  return (
    <div className={`p-5 rounded-xl border ${exp.status === 'running' ? 'border-emerald-500/30 bg-emerald-500/5' : exp.status === 'draft' ? 'border-orange-500/30 bg-orange-500/5' : 'border-zinc-800 bg-zinc-900/40'}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-sm font-semibold text-white flex-1">{exp.hypothesis}</p>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${badge.color}`}>{badge.label}</span>
      </div>
      <p className="text-[11px] text-zinc-500 mb-3">
        Proposed {new Date(exp.proposedAt).toLocaleDateString()} {exp.proposedBy === 'ai' && '· 🤖 AI-proposed'} · metric: {exp.metric} · {exp.splitPercent}% to variant B
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">A · {exp.variantALabel}</p>
          {exp.variantAPrompt ? (
            <p className="text-[12px] text-zinc-300 whitespace-pre-wrap line-clamp-4">{exp.variantAPrompt}</p>
          ) : (
            <p className="text-[12px] text-zinc-500 italic">Default behavior (no prompt override)</p>
          )}
        </div>
        <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">B · {exp.variantBLabel}</p>
          <p className="text-[12px] text-zinc-300 whitespace-pre-wrap line-clamp-4">{exp.variantBPrompt}</p>
        </div>
      </div>

      {stats && (exp.status === 'running' || exp.status === 'ended') && (
        <div className="grid grid-cols-3 gap-3 mb-3 p-3 rounded-lg bg-zinc-950 border border-zinc-800">
          <Stat label="A" exposures={stats.exposures.A} conversions={stats.conversions.A} rate={stats.rateA} />
          <Stat label="B" exposures={stats.exposures.B} conversions={stats.conversions.B} rate={stats.rateB} />
          <div>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Lift</p>
            <p className={`text-lg font-bold ${stats.liftPct > 0 ? 'text-emerald-400' : stats.liftPct < 0 ? 'text-red-400' : 'text-zinc-400'}`}>
              {stats.liftPct > 0 ? '+' : ''}{stats.liftPct.toFixed(1)}%
            </p>
            {!significant && (
              <p className="text-[10px] text-zinc-500">Need 50+ exposures</p>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mb-2 p-2 rounded border border-red-500/30 bg-red-500/5 text-[11px] text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        {exp.status === 'draft' && (
          <>
            <button
              onClick={() => patch({ status: 'running', approvedAt: new Date() }, 'start')}
              disabled={!!busy}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white hover:opacity-90 transition-colors"
              style={{ background: '#22c55e' }}
            >
              {busy === 'start' ? 'Starting…' : '▶ Start experiment'}
            </button>
            <button
              onClick={() => patch({ status: 'rejected' }, 'reject')}
              disabled={!!busy}
              className="text-xs font-medium px-3 py-1.5 rounded-lg text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 transition-colors"
            >
              Reject
            </button>
          </>
        )}
        {(exp.status === 'running' || exp.status === 'approved') && (
          <>
            <button
              onClick={() => patch({ promote: true, winner: 'B' }, 'promote-b')}
              disabled={!!busy}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white hover:opacity-90 transition-colors"
              style={{ background: '#22c55e' }}
            >
              {busy === 'promote-b' ? '…' : '⬆ Promote variant B'}
            </button>
            <button
              onClick={() => patch({ status: 'ended' }, 'end')}
              disabled={!!busy}
              className="text-xs font-medium px-3 py-1.5 rounded-lg text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 transition-colors"
            >
              End without promoting
            </button>
          </>
        )}
        <button onClick={remove} className="ml-auto text-[11px] text-red-400 hover:text-red-300 transition-colors">
          Delete
        </button>
      </div>
    </div>
  )
}

function Stat({ label, exposures, conversions, rate }: { label: string; exposures: number; conversions: number; rate: number }) {
  return (
    <div>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Variant {label}</p>
      <p className="text-lg font-bold text-white">{(rate * 100).toFixed(1)}%</p>
      <p className="text-[10px] text-zinc-500">{conversions} / {exposures} exposed</p>
    </div>
  )
}

function CreateModal({
  workspaceId, agentId, onClose, onCreated,
}: {
  workspaceId: string
  agentId: string
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const [hypothesis, setHypothesis] = useState('')
  const [variantBPrompt, setVariantBPrompt] = useState('')
  const [splitPercent, setSplitPercent] = useState(50)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/experiments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hypothesis, variantBPrompt, splitPercent, proposedBy: 'operator' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create')
        return
      }
      await onCreated()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-zinc-800 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">New experiment</h2>
            <p className="text-xs text-zinc-500 mt-1">
              Variant B will be appended to this agent&apos;s system prompt for the percentage of contacts you set below.
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none">×</button>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-300">{error}</div>}
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Hypothesis</label>
            <input
              type="text"
              value={hypothesis}
              onChange={e => setHypothesis(e.target.value)}
              placeholder='e.g. "Opening with a question instead of a greeting will lift booking rate"'
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Variant B — appended to system prompt</label>
            <textarea
              value={variantBPrompt}
              onChange={e => setVariantBPrompt(e.target.value)}
              rows={4}
              placeholder='e.g. "Open every conversation with a single direct question. Skip the greeting."'
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Split: {splitPercent}% to variant B</label>
            <input
              type="range"
              min={5}
              max={50}
              value={splitPercent}
              onChange={e => setSplitPercent(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-[10px] text-zinc-500 mt-1">5% is a safe pilot. 50% is a fast read.</p>
          </div>
          <div className="flex justify-end pt-2">
            <button
              onClick={create}
              disabled={saving || !hypothesis.trim() || !variantBPrompt.trim()}
              className="text-xs font-semibold px-5 py-2 rounded-lg text-white hover:opacity-90 transition-colors disabled:opacity-50"
              style={{ background: '#fa4d2e' }}
            >
              {saving ? 'Creating…' : 'Save as draft'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
