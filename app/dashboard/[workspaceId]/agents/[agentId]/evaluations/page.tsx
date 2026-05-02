'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Evaluation {
  id: string
  name: string
  scenario: string
  expectedContains: string[]
  expectedNotContains: string[]
  expectedTool: string | null
  runs: { id: string; passed: boolean; runAt: string; actualResponse: string | null; failureReasons: string[]; toolsCalled: string[] }[]
}

export default function EvaluationsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string
  const [evals, setEvals] = useState<Evaluation[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [running, setRunning] = useState<string | null>(null)
  const [runningAll, setRunningAll] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [notMigrated, setNotMigrated] = useState(false)

  // New-eval form state
  const [name, setName] = useState('')
  const [scenario, setScenario] = useState('')
  const [mustContain, setMustContain] = useState('')
  const [mustNotContain, setMustNotContain] = useState('')
  const [expectedTool, setExpectedTool] = useState('')

  const fetchEvals = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/evaluations`)
    const data = await res.json()
    setEvals(data.evaluations || [])
    setNotMigrated(!!data.notMigrated)
    setLoading(false)
  }, [workspaceId, agentId])

  useEffect(() => { fetchEvals() }, [fetchEvals])

  async function createEval() {
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/evaluations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        scenario,
        expectedContains: mustContain.split('\n').map(s => s.trim()).filter(Boolean),
        expectedNotContains: mustNotContain.split('\n').map(s => s.trim()).filter(Boolean),
        expectedTool: expectedTool.trim() || null,
      }),
    })
    setName(''); setScenario(''); setMustContain(''); setMustNotContain(''); setExpectedTool('')
    setShowNew(false)
    fetchEvals()
  }

  async function runOne(id: string) {
    setRunning(id)
    try {
      await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/evaluations/${id}/run`, { method: 'POST' })
      fetchEvals()
    } finally { setRunning(null) }
  }

  async function runAll() {
    setRunningAll(true)
    try {
      for (const e of evals) {
        await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/evaluations/${e.id}/run`, { method: 'POST' })
      }
      fetchEvals()
    } finally { setRunningAll(false) }
  }

  async function deleteEval(id: string) {
    if (!confirm('Delete this evaluation?')) return
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/evaluations/${id}`, { method: 'DELETE' })
    fetchEvals()
  }

  const passCount = evals.filter(e => e.runs[0]?.passed).length
  const hasRuns = evals.filter(e => e.runs.length > 0).length

  if (loading) return <div className="p-8"><div className="h-8 w-48 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} /></div>

  const createDisabled = !name || !scenario

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <Link href={`/dashboard/${workspaceId}/agents/${agentId}`} className="text-xs mb-4 inline-block transition-colors hover:opacity-80" style={{ color: 'var(--text-muted)' }}>← Back</Link>
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Evaluations</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Canned test scenarios. Run them before shipping prompt changes.</p>
          </div>
          {evals.length > 0 && (
            <button
              onClick={runAll}
              disabled={runningAll}
              className="text-xs font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition-colors"
              style={{ background: '#fa4d2e', color: '#fff', opacity: runningAll ? 0.6 : 1 }}
            >
              {runningAll ? 'Running...' : `Run all (${evals.length})`}
            </button>
          )}
        </div>

        {notMigrated && (
          <div className="p-4 mb-6 rounded-xl border" style={{ borderColor: 'var(--accent-amber)', background: 'var(--accent-amber-bg)' }}>
            <p className="text-sm font-medium" style={{ color: 'var(--accent-amber)' }}>Migration pending</p>
            <p className="text-xs mt-1" style={{ color: 'var(--accent-amber)', opacity: 0.7 }}>Run manual_symbiosis_wave2.sql</p>
          </div>
        )}

        {hasRuns > 0 && (
          <div className="mb-6 p-4 rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-tertiary)' }}>
                  <div className="h-full transition-all"
                    style={{
                      width: `${(passCount / hasRuns) * 100}%`,
                      background: 'linear-gradient(90deg, #22c55e, #16a34a)',
                    }}
                  />
                </div>
              </div>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {passCount}/{hasRuns} passing
              </span>
            </div>
          </div>
        )}

        {evals.length === 0 && !showNew ? (
          <div className="text-center py-12 border border-dashed rounded-xl" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No evaluations yet</p>
            <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>Create a test scenario to verify agent behavior.</p>
            <button
              onClick={() => setShowNew(true)}
              className="text-xs font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition-colors"
              style={{ background: '#fa4d2e', color: '#fff' }}
            >
              Create first evaluation
            </button>
          </div>
        ) : (
          <div className="space-y-2 mb-6">
            {evals.map(e => {
              const last = e.runs[0]
              const isOpen = expanded === e.id
              return (
                <div key={e.id} className="border rounded-xl overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                  <div className="p-4 flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      {last == null ? (
                        <div className="w-2 h-2 rounded-full" title="Never run" style={{ background: 'var(--text-muted)' }} />
                      ) : last.passed ? (
                        <div className="w-2 h-2 rounded-full" title="Passing" style={{ background: 'var(--accent-emerald)' }} />
                      ) : (
                        <div className="w-2 h-2 rounded-full" title="Failing" style={{ background: 'var(--accent-red)' }} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{e.name}</p>
                      <p className="text-xs italic mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>&ldquo;{e.scenario}&rdquo;</p>
                      {last && !last.passed && last.failureReasons.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {last.failureReasons.map((r, i) => (
                            <span key={i} className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ color: 'var(--accent-red)', background: 'var(--accent-red-bg)' }}>
                              {r}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {last && (
                        <button onClick={() => setExpanded(isOpen ? null : e.id)} className="text-[11px] px-2 py-1 transition-colors hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>
                          {isOpen ? 'Hide' : 'Details'}
                        </button>
                      )}
                      <button
                        onClick={() => runOne(e.id)}
                        disabled={running === e.id}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors hover:opacity-80"
                        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                      >
                        {running === e.id ? '...' : 'Run'}
                      </button>
                      <button onClick={() => deleteEval(e.id)} className="p-1 transition-colors hover:opacity-80" style={{ color: 'var(--text-muted)' }}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {isOpen && last && (
                    <div className="px-4 pb-4 border-t" style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)' }}>
                      <div className="mt-3">
                        <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Actual response</p>
                        <p className="text-xs p-3 rounded whitespace-pre-wrap" style={{ color: 'var(--text-secondary)', background: 'var(--surface-tertiary)' }}>{last.actualResponse || '—'}</p>
                      </div>
                      {last.toolsCalled.length > 0 && (
                        <div className="mt-2">
                          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Tools called</p>
                          <div className="flex gap-1 flex-wrap">
                            {last.toolsCalled.map(t => (
                              <span key={t} className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: 'rgba(168, 85, 247, 0.12)', color: 'rgb(147, 51, 234)' }}>🔧 {t}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {showNew ? (
          <div className="p-5 rounded-xl border space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>New evaluation</h3>
            <Input label="Name" value={name} onChange={setName} placeholder="e.g. Qualifies large team" />
            <Textarea label="Scenario (what the contact says)" value={scenario} onChange={setScenario} placeholder="Hi, I have a team of 50 engineers and need to start next week." />
            <Textarea
              label='Must contain (one per line)'
              value={mustContain}
              onChange={setMustContain}
              placeholder="demo&#10;calendar"
            />
            <Textarea
              label='Must NOT contain (one per line)'
              value={mustNotContain}
              onChange={setMustNotContain}
              placeholder="sorry&#10;I cannot"
            />
            <Input label="Expected tool (optional)" value={expectedTool} onChange={setExpectedTool} placeholder="book_appointment" />
            <div className="flex gap-2">
              <button onClick={createEval} disabled={createDisabled}
                className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors hover:opacity-90"
                style={{ background: createDisabled ? 'var(--surface-tertiary)' : '#fa4d2e', color: createDisabled ? 'var(--text-muted)' : '#fff', opacity: createDisabled ? 0.6 : 1 }}
              >
                Save evaluation
              </button>
              <button onClick={() => setShowNew(false)} className="text-xs font-medium px-3 py-2 rounded-lg transition-colors hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>
                Cancel
              </button>
            </div>
          </div>
        ) : evals.length > 0 && (
          <button onClick={() => setShowNew(true)}
            className="w-full text-center text-xs font-medium py-3 rounded-xl border border-dashed transition-colors hover:opacity-80"
            style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
          >
            + Add evaluation
          </button>
        )}
      </div>
    </div>
  )
}

function Input({ label, value, onChange, placeholder }: any) {
  return (
    <div>
      <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border rounded px-3 py-2 text-xs"
        style={{ background: 'var(--input-bg)', color: 'var(--input-text)', borderColor: 'var(--input-border)' }}
      />
    </div>
  )
}
function Textarea({ label, value, onChange, placeholder }: any) {
  return (
    <div>
      <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full border rounded px-3 py-2 text-xs font-mono"
        style={{ background: 'var(--input-bg)', color: 'var(--input-text)', borderColor: 'var(--input-border)' }}
      />
    </div>
  )
}
