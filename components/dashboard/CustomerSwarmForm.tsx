'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface Agent { id: string; name: string }

// Mirrors VALID_STYLES + STYLE_PROMPTS in lib/simulator.ts. Duplicated
// here so the form doesn't drag the whole simulator module into the
// client bundle. If a new persona ships, update both.
const PERSONAS = [
  { value: 'friendly',      label: 'Friendly',      blurb: 'Warm, cooperative, patient.' },
  { value: 'aggressive',    label: 'Aggressive',    blurb: 'Curt, impatient, pushes back hard.' },
  { value: 'passive',       label: 'Passive',       blurb: 'One-word answers; agent has to pull info.' },
  { value: 'skeptical',     label: 'Skeptical',     blurb: 'Questions everything, asks "what\'s the catch?"' },
  { value: 'confused',      label: 'Confused',      blurb: 'Mixes up details, forgets context.' },
  { value: 'ready_to_buy',  label: 'Ready to buy',  blurb: 'Wants to close fast; frustrated by stalling.' },
  { value: 'price_shopper', label: 'Price shopper', blurb: 'Hammers on price and discounts.' },
] as const

const CHANNELS = ['SMS', 'Email', 'WhatsApp', 'Live_Chat'] as const

interface Props {
  workspaceId: string
  agents: Agent[]
}

/**
 * Customer swarm form. Keeps the controls to a minimum:
 *   - one target agent
 *   - one scenario prompt (applied to every persona)
 *   - optional persona whitelist (default = all 7)
 *   - channel + max turns + runs per persona
 *
 * Submission POSTs to the customer swarm endpoint which creates the
 * SimulationSwarm + N queued Simulations and returns the swarm id.
 * We then redirect to the swarm detail page where the user watches
 * progress land.
 */
export default function CustomerSwarmForm({ workspaceId, agents }: Props) {
  const router = useRouter()
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '')
  const [scenario, setScenario] = useState('')
  const [channel, setChannel] = useState<typeof CHANNELS[number]>('SMS')
  const [selectedPersonas, setSelectedPersonas] = useState<Set<string>>(
    () => new Set(PERSONAS.map(p => p.value)),
  )
  const [maxTurns, setMaxTurns] = useState(8)
  const [runsPerPersona, setRunsPerPersona] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const total = selectedPersonas.size * runsPerPersona

  function togglePersona(v: string) {
    setSelectedPersonas(prev => {
      const next = new Set(prev)
      if (next.has(v)) next.delete(v)
      else next.add(v)
      return next
    })
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!agentId) return setError('Pick an agent.')
    if (!scenario.trim()) return setError('Write a scenario for the persona to start from.')
    if (selectedPersonas.size === 0) return setError('Pick at least one persona.')

    setSubmitting(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/simulation-swarms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          scenario: scenario.trim(),
          channel,
          personas: Array.from(selectedPersonas),
          runsPerPersona,
          maxTurns,
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        let detail = text.slice(0, 300)
        try {
          const parsed = JSON.parse(text)
          if (parsed?.error) detail = parsed.error
        } catch { /* */ }
        throw new Error(`${res.status} — ${detail}`)
      }
      const data = await res.json()
      router.push(`/dashboard/${workspaceId}/simulations/swarm/${data.swarmId}`)
    } catch (e: any) {
      setError(e.message ?? 'Failed to start swarm')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Agent under test">
        <select
          value={agentId}
          onChange={e => setAgentId(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600"
        >
          {agents.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </Field>

      <Field label="Channel">
        <div className="flex gap-2 flex-wrap">
          {CHANNELS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              className={`text-xs font-medium rounded-lg px-3 py-1.5 border transition-colors ${
                channel === c
                  ? 'border-zinc-600 bg-zinc-800 text-white'
                  : 'border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
              }`}
            >
              {c.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </Field>

      <Field
        label="Scenario"
        help="One prompt every persona starts from. They'll react to it differently based on style. Describe the situation concretely — what brought them to you, any constraints."
      >
        <textarea
          value={scenario}
          onChange={e => setScenario(e.target.value)}
          rows={4}
          placeholder="e.g. I saw your ad about SMS marketing. I run a 3-person real-estate team in Denver and I'm curious about pricing."
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
          maxLength={4000}
        />
      </Field>

      <Field label={`Personas (${selectedPersonas.size} selected)`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {PERSONAS.map(p => {
            const on = selectedPersonas.has(p.value)
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => togglePersona(p.value)}
                className={`text-left rounded-lg px-3 py-2 border transition-colors ${
                  on
                    ? 'border-blue-500/50 bg-blue-500/10'
                    : 'border-zinc-800 hover:border-zinc-600'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="text-sm text-zinc-100">{p.label}</div>
                  {on && <span className="text-[10px] text-blue-300">✓</span>}
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5">{p.blurb}</div>
              </button>
            )
          })}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Max turns per conversation" help="Safety cap. Most realistic chats resolve in 4–8.">
          <input
            type="number"
            min={2}
            max={20}
            value={maxTurns}
            onChange={e => setMaxTurns(parseInt(e.target.value, 10) || 8)}
            className="w-24 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600"
          />
        </Field>
        <Field label="Runs per persona" help="Same persona × multiple runs gives variance signal. Start at 1.">
          <input
            type="number"
            min={1}
            max={3}
            value={runsPerPersona}
            onChange={e => setRunsPerPersona(parseInt(e.target.value, 10) || 1)}
            className="w-24 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600"
          />
        </Field>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-400">
        Will queue <span className="text-zinc-100 font-semibold">{total}</span> simulation{total === 1 ? '' : 's'}.
        {total > 0 && (
          <span className="text-zinc-500"> · processor runs one per minute, so the last finishes in ~{total} min.</span>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || total === 0 || !scenario.trim()}
        className="text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-lg px-4 py-2 transition-colors"
      >
        {submitting ? 'Queuing…' : `Start swarm (${total} simulation${total === 1 ? '' : 's'})`}
      </button>
    </form>
  )
}

function Field({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-zinc-300">{label}</label>
      {help && <p className="text-[11px] text-zinc-500">{help}</p>}
      {children}
    </div>
  )
}
