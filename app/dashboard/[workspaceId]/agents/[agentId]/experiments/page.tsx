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

const STATUS_BADGE: Record<string, { style: React.CSSProperties; label: string }> = {
  draft:    { style: { background: 'var(--surface-tertiary)', color: 'var(--text-secondary)' }, label: 'Draft' },
  approved: { style: { background: 'rgba(59, 130, 246, 0.15)', color: 'rgb(59, 130, 246)' }, label: 'Approved' },
  running:  { style: { background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }, label: 'Running' },
  ended:    { style: { background: 'var(--surface-tertiary)', color: 'var(--text-muted)' }, label: 'Ended' },
  rejected: { style: { background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }, label: 'Rejected' },
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

  if (loading) return <div className="p-8"><div className="h-6 w-48 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} /></div>

  const drafts = experiments.filter(e => e.status === 'draft')
  const running = experiments.filter(e => e.status === 'running' || e.status === 'approved')
  const decided = experiments.filter(e => e.status === 'ended' || e.status === 'rejected')

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Experiments</h1>
          <p className="text-sm mt-1 max-w-2xl" style={{ color: 'var(--text-secondary)' }}>
            A/B test different opening lines, personas, or appended instructions on a slice of inbounds.
            The agent self-proposes hypotheses weekly — you approve which ones run.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="text-xs font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition-colors"
          style={{ background: '#fa4d2e', color: '#fff' }}
        >
          + New experiment
        </button>
      </div>

      {notMigrated && (
        <div className="p-4 mb-6 rounded-xl border text-sm" style={{ borderColor: 'var(--accent-amber)', background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }}>
          Run manual_agent_experiments.sql to enable experiments.
        </div>
      )}

      {experiments.length === 0 && !notMigrated ? (
        <div className="text-center py-16 border border-dashed rounded-xl" style={{ borderColor: 'var(--border)' }}>
          <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center text-2xl" style={{ background: 'var(--surface-tertiary)' }}>🧪</div>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No experiments yet</p>
          <p className="text-xs max-w-sm mx-auto" style={{ color: 'var(--text-muted)' }}>
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
      <h2 className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>{title}</h2>
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

  const cardStyle: React.CSSProperties =
    exp.status === 'running'
      ? { borderColor: 'var(--accent-emerald)', background: 'var(--accent-emerald-bg)' }
      : exp.status === 'draft'
      ? { borderColor: 'var(--accent-primary)', background: 'var(--accent-primary-bg)' }
      : { borderColor: 'var(--border)', background: 'var(--surface)' }

  return (
    <div className="p-5 rounded-xl border" style={cardStyle}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-sm font-semibold flex-1" style={{ color: 'var(--text-primary)' }}>{exp.hypothesis}</p>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={badge.style}>{badge.label}</span>
      </div>
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
        Proposed {new Date(exp.proposedAt).toLocaleDateString()} {exp.proposedBy === 'ai' && '· 🤖 AI-proposed'} · metric: {exp.metric} · {exp.splitPercent}% to variant B
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div className="p-3 rounded-lg border" style={{ background: 'var(--surface-secondary)', borderColor: 'var(--border)' }}>
          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>A · {exp.variantALabel}</p>
          {exp.variantAPrompt ? (
            <p className="text-[12px] whitespace-pre-wrap line-clamp-4" style={{ color: 'var(--text-secondary)' }}>{exp.variantAPrompt}</p>
          ) : (
            <p className="text-[12px] italic" style={{ color: 'var(--text-muted)' }}>Default behavior (no prompt override)</p>
          )}
        </div>
        <div className="p-3 rounded-lg border" style={{ background: 'var(--surface-secondary)', borderColor: 'var(--border)' }}>
          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>B · {exp.variantBLabel}</p>
          <p className="text-[12px] whitespace-pre-wrap line-clamp-4" style={{ color: 'var(--text-secondary)' }}>{exp.variantBPrompt}</p>
        </div>
      </div>

      {stats && (exp.status === 'running' || exp.status === 'ended') && (
        <div className="grid grid-cols-3 gap-3 mb-3 p-3 rounded-lg border" style={{ background: 'var(--surface-secondary)', borderColor: 'var(--border)' }}>
          <Stat label="A" exposures={stats.exposures.A} conversions={stats.conversions.A} rate={stats.rateA} />
          <Stat label="B" exposures={stats.exposures.B} conversions={stats.conversions.B} rate={stats.rateB} />
          <div>
            <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Lift</p>
            <p className="text-lg font-bold" style={{ color: stats.liftPct > 0 ? 'var(--accent-emerald)' : stats.liftPct < 0 ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
              {stats.liftPct > 0 ? '+' : ''}{stats.liftPct.toFixed(1)}%
            </p>
            {!significant && (
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Need 50+ exposures</p>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="mb-2 p-2 rounded border text-[11px]" style={{ borderColor: 'var(--accent-red)', background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}>
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        {exp.status === 'draft' && (
          <>
            <button
              onClick={() => patch({ status: 'running', approvedAt: new Date() }, 'start')}
              disabled={!!busy}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-90 transition-colors"
              style={{ background: '#22c55e', color: '#fff' }}
            >
              {busy === 'start' ? 'Starting…' : '▶ Start experiment'}
            </button>
            <button
              onClick={() => patch({ status: 'rejected' }, 'reject')}
              disabled={!!busy}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors hover:opacity-80"
              style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
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
              className="text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-90 transition-colors"
              style={{ background: '#22c55e', color: '#fff' }}
            >
              {busy === 'promote-b' ? '…' : '⬆ Promote variant B'}
            </button>
            <button
              onClick={() => patch({ status: 'ended' }, 'end')}
              disabled={!!busy}
              className="text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors hover:opacity-80"
              style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
            >
              End without promoting
            </button>
          </>
        )}
        <button onClick={remove} className="ml-auto text-[11px] transition-colors hover:opacity-80" style={{ color: 'var(--accent-red)' }}>
          Delete
        </button>
      </div>
    </div>
  )
}

function Stat({ label, exposures, conversions, rate }: { label: string; exposures: number; conversions: number; rate: number }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Variant {label}</p>
      <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{(rate * 100).toFixed(1)}%</p>
      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{conversions} / {exposures} exposed</p>
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

  const submitDisabled = saving || !hypothesis.trim() || !variantBPrompt.trim()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border shadow-2xl" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }} onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b flex items-start justify-between" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>New experiment</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Variant B will be appended to this agent&apos;s system prompt for the percentage of contacts you set below.
            </p>
          </div>
          <button onClick={onClose} className="text-xl leading-none transition-colors hover:opacity-80" style={{ color: 'var(--text-muted)' }}>×</button>
        </div>
        <div className="p-6 space-y-4">
          {error && <div className="p-3 rounded-lg border text-xs" style={{ borderColor: 'var(--accent-red)', background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}>{error}</div>}
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Hypothesis</label>
            <input
              type="text"
              value={hypothesis}
              onChange={e => setHypothesis(e.target.value)}
              placeholder='e.g. "Opening with a question instead of a greeting will lift booking rate"'
              className="w-full border rounded px-3 py-2 text-sm"
              style={{ background: 'var(--input-bg)', color: 'var(--input-text)', borderColor: 'var(--input-border)' }}
            />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Variant B — appended to system prompt</label>
            <textarea
              value={variantBPrompt}
              onChange={e => setVariantBPrompt(e.target.value)}
              rows={4}
              placeholder='e.g. "Open every conversation with a single direct question. Skip the greeting."'
              className="w-full border rounded px-3 py-2 text-sm"
              style={{ background: 'var(--input-bg)', color: 'var(--input-text)', borderColor: 'var(--input-border)' }}
            />
          </div>
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Split: {splitPercent}% to variant B</label>
            <input
              type="range"
              min={5}
              max={50}
              value={splitPercent}
              onChange={e => setSplitPercent(Number(e.target.value))}
              className="w-full"
            />
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>5% is a safe pilot. 50% is a fast read.</p>
          </div>
          <div className="flex justify-end pt-2">
            <button
              onClick={create}
              disabled={submitDisabled}
              className="text-xs font-semibold px-5 py-2 rounded-lg hover:opacity-90 transition-colors"
              style={{ background: submitDisabled ? 'var(--surface-tertiary)' : '#fa4d2e', color: submitDisabled ? 'var(--text-muted)' : '#fff', opacity: submitDisabled ? 0.6 : 1 }}
            >
              {saving ? 'Creating…' : 'Save as draft'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
