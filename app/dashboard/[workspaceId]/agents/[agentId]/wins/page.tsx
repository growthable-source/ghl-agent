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
  isPrimary: boolean
  aggressiveness: string
  triggerPhrases: string[]
  preferredTool: string | null
  instruction: string | null
  priority: number
  winsLast14: number
  winsLast30: number
  avgTurnsToWin: number | null
  createdAt: string
}

const GOAL_TYPES = [
  { value: 'appointment_booked', label: 'Appointment booked', needsValue: false, tool: 'book_appointment', triggers: ['speak to sales', 'schedule a call', 'book a demo', 'talk to someone', 'set up a meeting', 'hop on a call'] },
  { value: 'opportunity_created', label: 'Opportunity created', needsValue: false, tool: 'create_opportunity', triggers: ['interested', 'want to buy', 'ready to move forward'] },
  { value: 'opportunity_moved', label: 'Opportunity moved to stage', needsValue: true, placeholder: 'closed_won', tool: 'move_opportunity_stage', triggers: [] },
  { value: 'tag_added', label: 'Tag added', needsValue: true, placeholder: 'qualified', tool: 'update_contact_tags', triggers: [] },
  { value: 'custom', label: 'Custom action', needsValue: true, placeholder: 'send_email', tool: null, triggers: [] },
]

const AGGRESSIVENESS_LABELS: Record<string, { label: string; desc: string; color: string }> = {
  soft:       { label: 'Soft',       desc: 'Agent only acts when the user is obviously ready. Least pushy.',         color: '#a1a1aa' },
  moderate:   { label: 'Moderate',   desc: 'Agent acts after 1-2 quick qualifying questions.',                        color: '#fbbf24' },
  aggressive: { label: 'Aggressive', desc: 'Agent reaches for the tool on the first sign of intent. Best for booking.', color: '#fa4d2e' },
}

export default function WinsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [notMigrated, setNotMigrated] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState<{
    name: string
    goalType: string
    value: string
    maxTurns: string
    isPrimary: boolean
    aggressiveness: 'soft' | 'moderate' | 'aggressive'
    triggerPhrases: string
    instruction: string
  }>({
    name: '', goalType: 'appointment_booked', value: '', maxTurns: '',
    isPrimary: false, aggressiveness: 'moderate', triggerPhrases: '', instruction: '',
  })

  const fetchGoals = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/goals`)
    const data = await res.json()
    setGoals(data.goals || [])
    setNotMigrated(!!data.notMigrated)
    setLoading(false)
  }, [workspaceId, agentId])

  useEffect(() => { fetchGoals() }, [fetchGoals])

  function startEdit(g: Goal) {
    setEditingId(g.id)
    setForm({
      name: g.name,
      goalType: g.goalType,
      value: g.value || '',
      maxTurns: g.maxTurns?.toString() || '',
      isPrimary: g.isPrimary,
      aggressiveness: (g.aggressiveness as any) || 'moderate',
      triggerPhrases: (g.triggerPhrases || []).join('\n'),
      instruction: g.instruction || '',
    })
    setShowNew(false)
  }

  function startNew() {
    setEditingId(null)
    const isFirst = goals.length === 0
    setForm({
      name: '', goalType: 'appointment_booked', value: '', maxTurns: '',
      isPrimary: isFirst, aggressiveness: 'moderate', triggerPhrases: '', instruction: '',
    })
    setShowNew(true)
  }

  function applyTypeDefaults(type: string) {
    const t = GOAL_TYPES.find(x => x.value === type)
    setForm(f => ({
      ...f,
      goalType: type,
      // If the user hasn't typed triggers yet, pre-fill with sensible defaults
      triggerPhrases: f.triggerPhrases.trim() ? f.triggerPhrases : (t?.triggers || []).join('\n'),
    }))
  }

  async function save() {
    const payload: any = {
      name: form.name,
      goalType: form.goalType,
      value: form.value.trim() || null,
      maxTurns: form.maxTurns ? parseInt(form.maxTurns) : null,
      isPrimary: form.isPrimary,
      aggressiveness: form.aggressiveness,
      triggerPhrases: form.triggerPhrases.split('\n').map(s => s.trim()).filter(Boolean),
      instruction: form.instruction.trim() || null,
      preferredTool: GOAL_TYPES.find(t => t.value === form.goalType)?.tool ?? null,
    }

    if (editingId) {
      await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/goals/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    } else {
      await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    }
    setShowNew(false); setEditingId(null)
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
    if (!confirm('Delete this goal and all its recorded wins?')) return
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/goals/${id}`, { method: 'DELETE' })
    fetchGoals()
  }

  const selectedType = GOAL_TYPES.find(t => t.value === form.goalType)
  const isEditing = editingId !== null || showNew

  if (loading) return <div className="p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-3xl mx-auto">
        <Link href={`/dashboard/${workspaceId}/agents/${agentId}`} className="text-xs text-zinc-500 hover:text-zinc-300 mb-4 inline-block">← Back</Link>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Objectives &amp; Wins</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Tell the agent what success looks like. The primary objective is injected into the system prompt so the agent
            reaches for the right tool <em>decisively</em> — no more stalling with extra questions when the user has clearly
            signalled intent.
          </p>
        </div>

        {notMigrated && (
          <div className="p-4 mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5">
            <p className="text-sm text-amber-300">Run the objectives migration to enable this feature.</p>
          </div>
        )}

        {goals.length === 0 && !isEditing ? (
          <div className="text-center py-12 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
            <p className="text-sm font-medium text-white mb-1">No objectives defined yet</p>
            <p className="text-xs text-zinc-500 mb-4 max-w-sm mx-auto">
              Without a primary objective, your agent chats politely but may never book the meeting.
              Set one to make the agent act.
            </p>
            <button onClick={startNew} className="text-xs font-semibold px-4 py-2 rounded-lg text-white" style={{ background: '#fa4d2e' }}>
              Set first objective
            </button>
          </div>
        ) : (
          <div className="space-y-2 mb-4">
            {goals.map(g => (
              <div key={g.id} className={`p-4 rounded-xl border transition-colors ${
                g.isPrimary ? 'border-orange-500/40 bg-orange-500/5' : 'border-zinc-800 bg-zinc-900/40'
              }`}>
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggle(g.id, g.isActive)}
                    className="mt-0.5 relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0"
                    style={{ background: g.isActive ? '#22c55e' : '#3f3f46' }}
                    title={g.isActive ? 'Active' : 'Paused'}
                  >
                    <span className="inline-block h-3 w-3 rounded-full bg-white transition-transform"
                      style={{ transform: g.isActive ? 'translateX(20px)' : 'translateX(4px)' }} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {g.isPrimary && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                          style={{ background: 'rgba(250,77,46,0.15)', color: '#fa4d2e' }}>
                          Primary
                        </span>
                      )}
                      <p className="text-sm font-semibold text-white">{g.name}</p>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                        style={{ background: `${AGGRESSIVENESS_LABELS[g.aggressiveness]?.color}20`, color: AGGRESSIVENESS_LABELS[g.aggressiveness]?.color }}>
                        {AGGRESSIVENESS_LABELS[g.aggressiveness]?.label}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500">
                      {GOAL_TYPES.find(t => t.value === g.goalType)?.label || g.goalType}
                      {g.value && <> · <span className="font-mono text-zinc-400">{g.value}</span></>}
                      {g.maxTurns && <> · within {g.maxTurns} turns</>}
                      {g.preferredTool && <> · tool: <span className="font-mono text-zinc-400">{g.preferredTool}</span></>}
                    </p>
                    {g.triggerPhrases && g.triggerPhrases.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {g.triggerPhrases.slice(0, 5).map((p, i) => (
                          <span key={i} className="text-[10px] text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800">&ldquo;{p}&rdquo;</span>
                        ))}
                        {g.triggerPhrases.length > 5 && (
                          <span className="text-[10px] text-zinc-500">+{g.triggerPhrases.length - 5} more</span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-lg font-bold text-emerald-400">{g.winsLast30}</p>
                    <p className="text-[10px] text-zinc-500">30d</p>
                    {g.avgTurnsToWin && <p className="text-[10px] text-zinc-400">{g.avgTurnsToWin}t avg</p>}
                  </div>
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <button onClick={() => startEdit(g)} className="text-[10px] text-zinc-400 hover:text-white px-2 py-1 rounded hover:bg-zinc-800 transition-colors">
                      Edit
                    </button>
                    <button onClick={() => deleteGoal(g.id)} className="text-[10px] text-zinc-500 hover:text-red-400 px-2 py-1 rounded transition-colors">
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {isEditing ? (
          <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/60 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">{editingId ? 'Edit objective' : 'New objective'}</h3>
              {form.isPrimary && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                  style={{ background: 'rgba(250,77,46,0.15)', color: '#fa4d2e' }}>
                  Primary
                </span>
              )}
            </div>

            {/* Primary toggle */}
            <label className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-zinc-800 hover:border-zinc-700 transition-colors">
              <input type="checkbox" checked={form.isPrimary}
                onChange={e => setForm(f => ({ ...f, isPrimary: e.target.checked }))}
                className="mt-0.5 w-4 h-4 accent-orange-500"
              />
              <div>
                <p className="text-sm text-white">Make this the <strong>primary objective</strong></p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Pinned to the top of the system prompt. The agent treats this as the main goal.
                  Only one primary per agent.
                </p>
              </div>
            </label>

            <Field label="Name">
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Book demo with qualified leads"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white"
              />
            </Field>

            <Field label="What counts as a win">
              <select value={form.goalType} onChange={e => applyTypeDefaults(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white"
              >
                {GOAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              {selectedType?.tool && (
                <p className="text-[10px] text-zinc-500 mt-1">
                  Agent will use tool: <span className="font-mono text-zinc-400">{selectedType.tool}</span>
                </p>
              )}
            </Field>

            {selectedType?.needsValue && (
              <Field label="Value">
                <input value={form.value} onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                  placeholder={selectedType.placeholder}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white"
                />
              </Field>
            )}

            {/* Aggressiveness */}
            <Field label="How assertive should the agent be?">
              <div className="grid grid-cols-3 gap-2">
                {(['soft', 'moderate', 'aggressive'] as const).map(level => {
                  const cfg = AGGRESSIVENESS_LABELS[level]
                  const selected = form.aggressiveness === level
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, aggressiveness: level }))}
                      className="text-left p-3 rounded-lg border transition-colors"
                      style={selected
                        ? { borderColor: cfg.color, background: `${cfg.color}15` }
                        : { borderColor: '#27272a', background: 'transparent' }}
                    >
                      <p className="text-xs font-semibold" style={{ color: selected ? cfg.color : '#e4e4e7' }}>{cfg.label}</p>
                      <p className="text-[10px] text-zinc-500 mt-1 leading-snug">{cfg.desc}</p>
                    </button>
                  )
                })}
              </div>
            </Field>

            {/* Trigger phrases */}
            <Field label="Trigger phrases (one per line)" helper="When the contact says anything close to these, the agent immediately pursues this objective.">
              <textarea value={form.triggerPhrases}
                onChange={e => setForm(f => ({ ...f, triggerPhrases: e.target.value }))}
                placeholder={"speak to sales\nschedule a call\nbook a demo"}
                rows={4}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white font-mono"
              />
            </Field>

            {/* Custom instruction */}
            <Field label="Custom instruction (optional)" helper="Extra guidance appended to the objective block. Use this for tone or specific steps.">
              <textarea value={form.instruction}
                onChange={e => setForm(f => ({ ...f, instruction: e.target.value }))}
                placeholder="e.g. Always confirm the time zone before booking. Offer 3 slots in the next 48 hours."
                rows={3}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white"
              />
            </Field>

            {/* Max turns */}
            <Field label="Max turns to count as a win (optional)">
              <input type="number" value={form.maxTurns}
                onChange={e => setForm(f => ({ ...f, maxTurns: e.target.value }))}
                placeholder="5"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white"
              />
            </Field>

            <div className="flex gap-2 pt-2">
              <button onClick={save} disabled={!form.name}
                className="text-xs font-semibold px-4 py-2 rounded-lg text-white disabled:opacity-50 hover:opacity-90 transition-colors"
                style={{ background: '#fa4d2e' }}
              >
                {editingId ? 'Save changes' : 'Save objective'}
              </button>
              <button onClick={() => { setShowNew(false); setEditingId(null) }}
                className="text-xs font-medium px-3 py-2 rounded-lg text-zinc-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : goals.length > 0 && (
          <button onClick={startNew}
            className="w-full text-center text-xs font-medium py-3 rounded-xl border border-dashed border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors"
          >
            + Add objective
          </button>
        )}
      </div>
    </div>
  )
}

function Field({ label, helper, children }: { label: string; helper?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-zinc-300 mb-1 block font-medium">{label}</label>
      {children}
      {helper && <p className="text-[10px] text-zinc-500 mt-1">{helper}</p>}
    </div>
  )
}
