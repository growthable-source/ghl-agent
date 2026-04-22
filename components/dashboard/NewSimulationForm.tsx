'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface Agent {
  id: string
  name: string
}
interface Props {
  workspaceId: string
  agents: Agent[]
}

// Styles here mirror VALID_STYLES in lib/simulator.ts. Kept as a literal
// array for now — the two drift-together only in this one form, and
// re-using SSR/server-side exports in a client component would drag the
// whole simulator into the browser bundle.
const STYLES = [
  { value: 'friendly', label: 'Friendly', desc: 'Warm, cooperative, patient.' },
  { value: 'aggressive', label: 'Aggressive', desc: 'Curt, impatient, pushes back hard.' },
  { value: 'passive', label: 'Passive', desc: 'One-word answers; agent has to pull info.' },
  { value: 'skeptical', label: 'Skeptical', desc: 'Questions everything, asks "what\'s the catch?"' },
  { value: 'confused', label: 'Confused', desc: 'Mixes up details, forgets context.' },
  { value: 'ready_to_buy', label: 'Ready to buy', desc: 'Wants to close fast; frustrated by stalling.' },
  { value: 'price_shopper', label: 'Price shopper', desc: 'Hammers on price and discounts.' },
] as const

const CHANNELS = ['SMS', 'Email', 'WhatsApp', 'Live_Chat'] as const

export default function NewSimulationForm({ workspaceId, agents }: Props) {
  const router = useRouter()
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '')
  const [channel, setChannel] = useState<typeof CHANNELS[number]>('SMS')
  const [style, setStyle] = useState<typeof STYLES[number]['value']>('friendly')
  const [personaContext, setPersonaContext] = useState('')
  const [goal, setGoal] = useState('')
  const [maxTurns, setMaxTurns] = useState(8)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!personaContext.trim() || !agentId) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/simulations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId, channel, style,
          personaContext: personaContext.trim(),
          goal: goal.trim() || null,
          maxTurns,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      router.push(`/dashboard/${workspaceId}/simulations/${data.simulationId}`)
    } catch (e: any) {
      setError(e.message ?? 'Failed to start simulation')
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

      <Field label="Channel" help="Which medium the simulated contact is messaging from.">
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

      <Field label="Communication style" help="How the simulated customer behaves during the conversation.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {STYLES.map(s => (
            <button
              key={s.value}
              type="button"
              onClick={() => setStyle(s.value)}
              className={`text-left rounded-lg px-3 py-2 border transition-colors ${
                style === s.value
                  ? 'border-blue-500/50 bg-blue-500/10'
                  : 'border-zinc-800 hover:border-zinc-600'
              }`}
            >
              <div className="text-sm text-zinc-100">{s.label}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">{s.desc}</div>
            </button>
          ))}
        </div>
      </Field>

      <Field
        label="Persona context"
        help="Describe who the simulated customer is, what they want, and any relevant background. Specific beats vague."
      >
        <textarea
          value={personaContext}
          onChange={e => setPersonaContext(e.target.value)}
          rows={4}
          placeholder="e.g. I'm a small-business owner in Denver. I saw an ad for your SMS marketing tool and I'm curious but my budget is tight — I can spend maybe $200/month. I've been burned by pushy sales pitches before."
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
          maxLength={4000}
        />
      </Field>

      <Field label="Goal (optional)" help="What you want to test — e.g. 'try to book a demo' or 'complain about billing'. Leave blank to let the persona react naturally.">
        <input
          type="text"
          value={goal}
          onChange={e => setGoal(e.target.value)}
          placeholder="e.g. Push to book a call before giving your email"
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
          maxLength={1000}
        />
      </Field>

      <Field label="Max turns" help="Upper bound on back-and-forth. Most conversations resolve in 4–8 turns.">
        <input
          type="number"
          min={2}
          max={20}
          value={maxTurns}
          onChange={e => setMaxTurns(parseInt(e.target.value, 10) || 8)}
          className="w-24 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600"
        />
      </Field>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={submitting || !personaContext.trim() || !agentId}
          className="text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-lg px-4 py-2 transition-colors"
        >
          {submitting ? 'Running simulation…' : 'Run simulation'}
        </button>
        <p className="text-[11px] text-zinc-500">
          Runs synchronously — can take 30–60 seconds. You&apos;ll land on the result when done.
        </p>
      </div>
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
