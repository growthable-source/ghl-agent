'use client'

/**
 * Procedure builder — the ordered steps a PROCEDURAL agent walks through.
 *
 * Simple mode: title + instruction per step.
 * Advanced mode: each step can also ask a question, save the answer to a
 * field, and carry answer rules (when answer contains X → skip / jump / stop).
 *
 * Only reachable for agents with agentKind="procedural" (the tab is hidden
 * otherwise). Saves via PUT /procedure (replace-all).
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type RuleAction = 'skip' | 'jump' | 'stop'
interface Rule { when: string; action: RuleAction; target?: string }
interface Step {
  title: string
  instruction: string
  question: string
  collectFieldKey: string
  rules: Rule[]
}

const emptyStep = (): Step => ({ title: '', instruction: '', question: '', collectFieldKey: '', rules: [] })

const card = { background: 'var(--surface)', border: '1px solid var(--border)' } as const
const input = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' } as const

export default function ProcedurePage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [steps, setSteps] = useState<Step[]>([])
  const [mode, setMode] = useState<'simple' | 'advanced'>('simple')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [migrationPending, setMigrationPending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [agentRes, procRes] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`).then(r => r.json()).catch(() => ({})),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/procedure`).then(r => r.json()).catch(() => ({})),
    ])
    setMode(agentRes?.agent?.procedureMode === 'advanced' ? 'advanced' : 'simple')
    setMigrationPending(!!procRes?.migrationPending)
    setSteps(
      Array.isArray(procRes?.steps)
        ? procRes.steps.map((s: any) => ({
            title: s.title ?? '',
            instruction: s.instruction ?? '',
            question: s.question ?? '',
            collectFieldKey: s.collectFieldKey ?? '',
            rules: Array.isArray(s.rules) ? s.rules : [],
          }))
        : [],
    )
    setLoading(false)
  }, [workspaceId, agentId])

  useEffect(() => { load() }, [load])

  function patchStep(i: number, patch: Partial<Step>) {
    setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s))
  }
  function move(i: number, dir: -1 | 1) {
    setSteps(prev => {
      const next = [...prev]
      const j = i + dir
      if (j < 0 || j >= next.length) return prev
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  function addRule(i: number) {
    setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, rules: [...s.rules, { when: '', action: 'skip' as RuleAction }] } : s))
  }
  function patchRule(i: number, ri: number, patch: Partial<Rule>) {
    setSteps(prev => prev.map((s, idx) => idx === i ? { ...s, rules: s.rules.map((r, rj) => rj === ri ? { ...r, ...patch } : r) } : s))
  }

  async function setProcedureMode(next: 'simple' | 'advanced') {
    setMode(next)
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ procedureMode: next }),
    }).catch(() => {})
  }

  async function save() {
    setSaving(true); setError(null); setSaved(false)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/procedure`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps: steps.filter(s => s.title.trim() && s.instruction.trim()) }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to save.'); return }
      setSaved(true); setTimeout(() => setSaved(false), 1500)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-8 max-w-2xl"><div className="h-40 rounded-xl animate-pulse" style={{ background: 'var(--surface)' }} /></div>
  }

  return (
    <div className="p-8 max-w-2xl">
      <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
        The ordered steps this agent walks the contact through. It tracks progress (&ldquo;step 2 of {Math.max(steps.length, 1)}&rdquo;) and only advances when a step&rsquo;s goal is met.
      </p>
      <p className="text-xs mb-5" style={{ color: 'var(--text-tertiary)' }}>
        Simple = written steps. Advanced = steps can ask a question and branch on the answer.
      </p>

      {migrationPending && (
        <div className="mb-4 text-sm rounded-lg px-3 py-2" style={{ background: 'var(--surface)', color: 'var(--text-tertiary)' }}>
          Migration pending — run <code>prisma/migrations/20260618160000_procedural_agents/migration.sql</code> to enable saving steps.
        </div>
      )}

      {/* Mode toggle */}
      <div className="flex gap-2 mb-5">
        {(['simple', 'advanced'] as const).map(m => (
          <button key={m} onClick={() => setProcedureMode(m)}
            className="text-xs px-3 py-1.5 rounded-lg border capitalize transition-colors"
            style={mode === m
              ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' }
              : { color: 'var(--text-secondary)', borderColor: 'var(--border)' }}>
            {m}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {steps.map((s, i) => (
          <div key={i} className="rounded-xl p-4" style={card}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold" style={{ color: 'var(--text-tertiary)' }}>Step {i + 1}</span>
              <div className="flex gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                <button onClick={() => move(i, -1)} disabled={i === 0} className="disabled:opacity-30">↑</button>
                <button onClick={() => move(i, 1)} disabled={i === steps.length - 1} className="disabled:opacity-30">↓</button>
                <button onClick={() => setSteps(prev => prev.filter((_, idx) => idx !== i))} style={{ color: '#f87171' }}>Remove</button>
              </div>
            </div>
            <input value={s.title} onChange={e => patchStep(i, { title: e.target.value })}
              placeholder="Step title (e.g. Collect email)"
              className="w-full rounded-lg px-3 py-2 text-sm mb-2" style={input} />
            <textarea value={s.instruction} onChange={e => patchStep(i, { instruction: e.target.value })}
              placeholder="What the agent does / says in this step" rows={2}
              className="w-full rounded-lg px-3 py-2 text-sm resize-none" style={input} />

            {mode === 'advanced' && (
              <div className="mt-3 pt-3 space-y-2" style={{ borderTop: '1px solid var(--border)' }}>
                <input value={s.question} onChange={e => patchStep(i, { question: e.target.value })}
                  placeholder="Question to ask (optional)"
                  className="w-full rounded-lg px-3 py-2 text-sm" style={input} />
                <input value={s.collectFieldKey} onChange={e => patchStep(i, { collectFieldKey: e.target.value })}
                  placeholder="Save answer to field key (optional, e.g. custom.plan)"
                  className="w-full rounded-lg px-3 py-2 text-sm" style={input} />
                <div className="space-y-1.5">
                  {s.rules.map((r, ri) => (
                    <div key={ri} className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span style={{ color: 'var(--text-tertiary)' }}>If answer contains</span>
                      <input value={r.when} onChange={e => patchRule(i, ri, { when: e.target.value })}
                        placeholder="keyword" className="rounded px-2 py-1 w-28" style={input} />
                      <span style={{ color: 'var(--text-tertiary)' }}>→</span>
                      <select value={r.action} onChange={e => patchRule(i, ri, { action: e.target.value as RuleAction })}
                        className="rounded px-2 py-1" style={input}>
                        <option value="skip">skip this step</option>
                        <option value="jump">jump to step</option>
                        <option value="stop">stop / hand off</option>
                      </select>
                      {r.action === 'jump' && (
                        <select value={r.target ?? ''} onChange={e => patchRule(i, ri, { target: e.target.value })}
                          className="rounded px-2 py-1" style={input}>
                          <option value="">choose step…</option>
                          {steps.map((st, sj) => st.title.trim() ? <option key={sj} value={st.title}>{st.title}</option> : null)}
                        </select>
                      )}
                      <button onClick={() => patchStep(i, { rules: s.rules.filter((_, rj) => rj !== ri) })}
                        style={{ color: '#f87171' }}>×</button>
                    </div>
                  ))}
                  <button onClick={() => addRule(i)} className="text-xs" style={{ color: 'var(--accent-primary)' }}>+ Add rule</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <button onClick={() => setSteps(prev => [...prev, emptyStep()])}
        className="w-full mt-3 rounded-xl py-3 text-sm border border-dashed transition-colors"
        style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}>
        + Add step
      </button>

      {error && <div className="mt-4 text-sm rounded-lg px-3 py-2" style={{ background: 'rgba(220,38,38,0.1)', color: '#f87171' }}>{error}</div>}

      <div className="mt-5 flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-50"
          style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}>
          {saving ? 'Saving…' : 'Save procedure'}
        </button>
        {saved && <span className="text-xs" style={{ color: 'var(--accent-emerald)' }}>✓ Saved</span>}
      </div>
    </div>
  )
}
