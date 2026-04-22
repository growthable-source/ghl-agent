'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface AgentOption {
  id: string
  name: string
  workspace: string
}

const STYLES = [
  'friendly', 'aggressive', 'passive', 'skeptical',
  'confused', 'ready_to_buy', 'price_shopper',
] as const

const CHANNELS = ['SMS', 'Email', 'WhatsApp', 'Live_Chat'] as const

interface PersonaDraft {
  context: string
  style: typeof STYLES[number]
  channel: typeof CHANNELS[number]
  goal: string
  maxTurns: number
}

function emptyPersona(): PersonaDraft {
  return { context: '', style: 'friendly', channel: 'SMS', goal: '', maxTurns: 8 }
}

export default function NewSwarmForm({ agents }: { agents: AgentOption[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set())
  const [personas, setPersonas] = useState<PersonaDraft[]>([emptyPersona()])
  const [runsPerAgent, setRunsPerAgent] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalPlanned = selectedAgents.size * personas.filter(p => p.context.trim()).length * runsPerAgent

  function toggleAgent(id: string) {
    setSelectedAgents(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function selectAllAgents() {
    setSelectedAgents(new Set(agents.map(a => a.id)))
  }

  function clearAgents() {
    setSelectedAgents(new Set())
  }

  function updatePersona(i: number, patch: Partial<PersonaDraft>) {
    setPersonas(prev => prev.map((p, idx) => idx === i ? { ...p, ...patch } : p))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const validPersonas = personas.filter(p => p.context.trim())
    if (!name.trim()) return setError('Name required.')
    if (selectedAgents.size === 0) return setError('Pick at least one agent.')
    if (validPersonas.length === 0) return setError('Add at least one persona with context.')
    if (totalPlanned > 500) return setError(`That would queue ${totalPlanned} simulations — cap is 500 per swarm.`)

    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/simulation-swarms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          agentIds: Array.from(selectedAgents),
          personaProfiles: validPersonas.map(p => ({
            context: p.context.trim(),
            style: p.style,
            channel: p.channel,
            goal: p.goal.trim() || null,
            maxTurns: p.maxTurns,
          })),
          runsPerAgent,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      router.push(`/admin/simulation-swarms/${data.swarmId}`)
    } catch (e: any) {
      setError(e.message ?? 'Failed to create swarm')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Name">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Aggressive price-shoppers vs all agents"
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
          maxLength={120}
        />
      </Field>

      <Field label={`Agents (${selectedAgents.size} selected)`}>
        <div className="flex items-center gap-2 mb-2">
          <button type="button" onClick={selectAllAgents} className="text-[11px] text-zinc-400 hover:text-white">
            Select all
          </button>
          <span className="text-zinc-700">·</span>
          <button type="button" onClick={clearAgents} className="text-[11px] text-zinc-400 hover:text-white">
            Clear
          </button>
        </div>
        <div className="max-h-64 overflow-y-auto rounded border border-zinc-800 bg-zinc-950 divide-y divide-zinc-900">
          {agents.map(a => {
            const picked = selectedAgents.has(a.id)
            return (
              <label key={a.id} className="flex items-center gap-3 px-3 py-2 hover:bg-zinc-900/60 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={picked}
                  onChange={() => toggleAgent(a.id)}
                  className="accent-blue-500"
                />
                <span className="text-zinc-200 flex-1">{a.name}</span>
                <span className="text-zinc-500">{a.workspace}</span>
              </label>
            )
          })}
          {agents.length === 0 && (
            <div className="p-4 text-center text-zinc-500 text-xs">No active agents to target.</div>
          )}
        </div>
      </Field>

      <Field label="Personas">
        <div className="space-y-3">
          {personas.map((p, i) => (
            <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-zinc-500">Persona {i + 1}</span>
                {personas.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setPersonas(prev => prev.filter((_, idx) => idx !== i))}
                    className="text-[11px] text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                )}
              </div>
              <textarea
                value={p.context}
                onChange={e => updatePersona(i, { context: e.target.value })}
                rows={3}
                placeholder="Who they are + what they want + background…"
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
                maxLength={4000}
              />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <select
                  value={p.style}
                  onChange={e => updatePersona(i, { style: e.target.value as any })}
                  className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200"
                >
                  {STYLES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                </select>
                <select
                  value={p.channel}
                  onChange={e => updatePersona(i, { channel: e.target.value as any })}
                  className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200"
                >
                  {CHANNELS.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                </select>
                <input
                  type="text"
                  value={p.goal}
                  onChange={e => updatePersona(i, { goal: e.target.value })}
                  placeholder="Goal (optional)"
                  className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600"
                  maxLength={500}
                />
                <input
                  type="number"
                  min={2}
                  max={20}
                  value={p.maxTurns}
                  onChange={e => updatePersona(i, { maxTurns: parseInt(e.target.value, 10) || 8 })}
                  className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200"
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setPersonas(prev => [...prev, emptyPersona()])}
            className="text-xs text-zinc-400 hover:text-white"
          >
            + Add persona
          </button>
        </div>
      </Field>

      <Field label="Runs per agent × persona">
        <input
          type="number"
          min={1}
          max={20}
          value={runsPerAgent}
          onChange={e => setRunsPerAgent(parseInt(e.target.value, 10) || 1)}
          className="w-24 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200"
        />
      </Field>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-400">
        Will queue <span className="text-zinc-100 font-semibold">{totalPlanned}</span> simulations.
        {totalPlanned > 0 && (
          <span className="text-zinc-500"> · at one per minute, the last one completes in ~{totalPlanned} minutes.</span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">{error}</div>
      )}

      <button
        type="submit"
        disabled={submitting || totalPlanned === 0}
        className="text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-lg px-4 py-2 transition-colors"
      >
        {submitting ? 'Queuing…' : `Queue ${totalPlanned} simulations`}
      </button>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-zinc-300">{label}</label>
      {children}
    </div>
  )
}
