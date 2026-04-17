'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Goal {
  id: string
  name: string
  goalType: string
  value: string | null
  isActive: boolean
  maxTurns: number | null
  winsLast14: number
  winsLast30: number
  avgTurnsToWin: number | null
  createdAt: string
}

const GOAL_TYPES = [
  { value: 'appointment_booked', label: 'Appointment booked', needsValue: false },
  { value: 'tag_added', label: 'Tag added', needsValue: true, placeholder: 'qualified' },
  { value: 'opportunity_moved', label: 'Opportunity moved to stage', needsValue: true, placeholder: 'closed_won' },
  { value: 'opportunity_created', label: 'Opportunity created', needsValue: false },
  { value: 'custom', label: 'Custom action', needsValue: true, placeholder: 'send_email' },
]

export default function WinsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [notMigrated, setNotMigrated] = useState(false)

  const [showNew, setShowNew] = useState(false)
  const [name, setName] = useState('')
  const [goalType, setGoalType] = useState('appointment_booked')
  const [value, setValue] = useState('')
  const [maxTurns, setMaxTurns] = useState('')

  const fetchGoals = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/goals`)
    const data = await res.json()
    setGoals(data.goals || [])
    setNotMigrated(!!data.notMigrated)
    setLoading(false)
  }, [workspaceId, agentId])

  useEffect(() => { fetchGoals() }, [fetchGoals])

  async function createGoal() {
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/goals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, goalType,
        value: value.trim() || null,
        maxTurns: maxTurns ? parseInt(maxTurns) : null,
      }),
    })
    setName(''); setValue(''); setMaxTurns(''); setGoalType('appointment_booked'); setShowNew(false)
    fetchGoals()
  }

  async function toggle(id: string, current: boolean) {
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/goals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !current }),
    })
    fetchGoals()
  }

  async function deleteGoal(id: string) {
    if (!confirm('Delete this win-goal and all its recorded wins?')) return
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/goals/${id}`, { method: 'DELETE' })
    fetchGoals()
  }

  const selectedType = GOAL_TYPES.find(t => t.value === goalType)

  if (loading) return <div className="p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-3xl mx-auto">
        <Link href={`/dashboard/${workspaceId}/agents/${agentId}`} className="text-xs text-zinc-500 hover:text-zinc-300 mb-4 inline-block">← Back</Link>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Win Goals</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Define what success looks like. Wins are recorded automatically when the conditions are met.
          </p>
        </div>

        {notMigrated && (
          <div className="p-4 mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5">
            <p className="text-sm text-amber-300">Run manual_symbiosis_wave2.sql to enable win tracking.</p>
          </div>
        )}

        {goals.length === 0 && !showNew ? (
          <div className="text-center py-12 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
            <p className="text-sm font-medium text-white mb-1">No win goals defined yet</p>
            <p className="text-xs text-zinc-500 mb-4">Without goals, we track messages — not outcomes.</p>
            <button onClick={() => setShowNew(true)} className="text-xs font-semibold px-4 py-2 rounded-lg text-white" style={{ background: '#fa4d2e' }}>
              Define first goal
            </button>
          </div>
        ) : (
          <div className="space-y-2 mb-4">
            {goals.map(g => (
              <div key={g.id} className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggle(g.id, g.isActive)}
                    className="mt-0.5 relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
                    style={{ background: g.isActive ? '#22c55e' : '#3f3f46' }}
                  >
                    <span className="inline-block h-3 w-3 rounded-full bg-white transition-transform"
                      style={{ transform: g.isActive ? 'translateX(20px)' : 'translateX(4px)' }} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white">{g.name}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      {GOAL_TYPES.find(t => t.value === g.goalType)?.label || g.goalType}
                      {g.value && <> · <span className="font-mono text-zinc-400">{g.value}</span></>}
                      {g.maxTurns && <> · within {g.maxTurns} turns</>}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-emerald-400">{g.winsLast30}</p>
                    <p className="text-[10px] text-zinc-500">30d</p>
                    {g.avgTurnsToWin && <p className="text-[10px] text-zinc-400">{g.avgTurnsToWin}t avg</p>}
                  </div>
                  <button onClick={() => deleteGoal(g.id)} className="text-zinc-500 hover:text-red-400 p-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {showNew ? (
          <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/60 space-y-4">
            <h3 className="text-sm font-semibold text-white">New win goal</h3>
            <Field label="Name">
              <input value={name} onChange={e => setName(e.target.value)}
                placeholder="e.g. Book demo with qualified leads"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white" />
            </Field>
            <Field label="What counts as a win">
              <select value={goalType} onChange={e => setGoalType(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white">
                {GOAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
            {selectedType?.needsValue && (
              <Field label="Value">
                <input value={value} onChange={e => setValue(e.target.value)}
                  placeholder={selectedType.placeholder}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white" />
              </Field>
            )}
            <Field label="Max turns (optional)">
              <input type="number" value={maxTurns} onChange={e => setMaxTurns(e.target.value)}
                placeholder="5"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white" />
            </Field>
            <div className="flex gap-2">
              <button onClick={createGoal} disabled={!name}
                className="text-xs font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-50"
                style={{ background: '#fa4d2e' }}>
                Save goal
              </button>
              <button onClick={() => setShowNew(false)} className="text-xs font-medium px-3 py-2 rounded-lg text-zinc-400 hover:text-white">
                Cancel
              </button>
            </div>
          </div>
        ) : goals.length > 0 && (
          <button onClick={() => setShowNew(true)}
            className="w-full text-center text-xs font-medium py-3 rounded-xl border border-dashed border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors"
          >
            + Add goal
          </button>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-zinc-400 mb-1 block">{label}</label>
      {children}
    </div>
  )
}
