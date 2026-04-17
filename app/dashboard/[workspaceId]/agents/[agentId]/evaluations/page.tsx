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

  if (loading) return <div className="p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <Link href={`/dashboard/${workspaceId}/agents/${agentId}`} className="text-xs text-zinc-500 hover:text-zinc-300 mb-4 inline-block">← Back</Link>
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Evaluations</h1>
            <p className="text-sm text-zinc-400 mt-1">Canned test scenarios. Run them before shipping prompt changes.</p>
          </div>
          {evals.length > 0 && (
            <button
              onClick={runAll}
              disabled={runningAll}
              className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-colors"
              style={{ background: '#fa4d2e' }}
            >
              {runningAll ? 'Running...' : `Run all (${evals.length})`}
            </button>
          )}
        </div>

        {notMigrated && (
          <div className="p-4 mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5">
            <p className="text-sm text-amber-300 font-medium">Migration pending</p>
            <p className="text-xs text-amber-300/70 mt-1">Run manual_symbiosis_wave2.sql</p>
          </div>
        )}

        {hasRuns > 0 && (
          <div className="mb-6 p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full transition-all"
                    style={{
                      width: `${(passCount / hasRuns) * 100}%`,
                      background: 'linear-gradient(90deg, #22c55e, #16a34a)',
                    }}
                  />
                </div>
              </div>
              <span className="text-sm font-semibold text-white">
                {passCount}/{hasRuns} passing
              </span>
            </div>
          </div>
        )}

        {evals.length === 0 && !showNew ? (
          <div className="text-center py-12 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
            <p className="text-sm font-medium text-white mb-1">No evaluations yet</p>
            <p className="text-xs text-zinc-500 mb-4">Create a test scenario to verify agent behavior.</p>
            <button
              onClick={() => setShowNew(true)}
              className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-colors"
              style={{ background: '#fa4d2e' }}
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
                <div key={e.id} className="border border-zinc-800 rounded-xl bg-zinc-900/40 overflow-hidden">
                  <div className="p-4 flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      {last == null ? (
                        <div className="w-2 h-2 rounded-full bg-zinc-600" title="Never run" />
                      ) : last.passed ? (
                        <div className="w-2 h-2 rounded-full bg-emerald-500" title="Passing" />
                      ) : (
                        <div className="w-2 h-2 rounded-full bg-red-500" title="Failing" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white">{e.name}</p>
                      <p className="text-xs text-zinc-500 italic mt-0.5 truncate">&ldquo;{e.scenario}&rdquo;</p>
                      {last && !last.passed && last.failureReasons.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {last.failureReasons.map((r, i) => (
                            <span key={i} className="text-[10px] font-medium text-red-400 px-2 py-0.5 rounded-full bg-red-500/10">
                              {r}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {last && (
                        <button onClick={() => setExpanded(isOpen ? null : e.id)} className="text-[11px] text-zinc-400 hover:text-white px-2 py-1">
                          {isOpen ? 'Hide' : 'Details'}
                        </button>
                      )}
                      <button
                        onClick={() => runOne(e.id)}
                        disabled={running === e.id}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
                      >
                        {running === e.id ? '...' : 'Run'}
                      </button>
                      <button onClick={() => deleteEval(e.id)} className="text-zinc-500 hover:text-red-400 p-1">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {isOpen && last && (
                    <div className="px-4 pb-4 border-t border-zinc-800 bg-zinc-950/40">
                      <div className="mt-3">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Actual response</p>
                        <p className="text-xs text-zinc-300 p-3 rounded bg-zinc-900 whitespace-pre-wrap">{last.actualResponse || '—'}</p>
                      </div>
                      {last.toolsCalled.length > 0 && (
                        <div className="mt-2">
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Tools called</p>
                          <div className="flex gap-1 flex-wrap">
                            {last.toolsCalled.map(t => (
                              <span key={t} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400">🔧 {t}</span>
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
          <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/60 space-y-4">
            <h3 className="text-sm font-semibold text-white">New evaluation</h3>
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
              <button onClick={createEval} disabled={!name || !scenario}
                className="text-xs font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-50 transition-colors"
                style={{ background: '#fa4d2e' }}
              >
                Save evaluation
              </button>
              <button onClick={() => setShowNew(false)} className="text-xs font-medium px-3 py-2 rounded-lg text-zinc-400 hover:text-white">
                Cancel
              </button>
            </div>
          </div>
        ) : evals.length > 0 && (
          <button onClick={() => setShowNew(true)}
            className="w-full text-center text-xs font-medium py-3 rounded-xl border border-dashed border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors"
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
      <label className="text-xs text-zinc-400 mb-1 block">{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white"
      />
    </div>
  )
}
function Textarea({ label, value, onChange, placeholder }: any) {
  return (
    <div>
      <label className="text-xs text-zinc-400 mb-1 block">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white font-mono"
      />
    </div>
  )
}
