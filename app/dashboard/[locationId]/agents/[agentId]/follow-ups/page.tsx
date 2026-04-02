'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface FollowUpStep {
  stepNumber: number
  delayHours: number
  message: string
}

interface FollowUpSequence {
  id: string
  name: string
  isActive: boolean
  steps: Array<FollowUpStep & { id: string }>
}

export default function FollowUpsPage() {
  const params = useParams()
  const locationId = params.locationId as string
  const agentId = params.agentId as string

  const [sequences, setSequences] = useState<FollowUpSequence[]>([])
  const [loading, setLoading] = useState(true)

  // New sequence form
  const [newName, setNewName] = useState('')
  const [newSteps, setNewSteps] = useState<FollowUpStep[]>([{ stepNumber: 1, delayHours: 24, message: '' }])
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetch(`/api/locations/${locationId}/agents/${agentId}/follow-up-sequences`)
      .then(r => r.json())
      .then(({ sequences }) => setSequences(sequences ?? []))
      .finally(() => setLoading(false))
  }, [locationId, agentId])

  async function toggleActive(seq: FollowUpSequence) {
    const res = await fetch(`/api/locations/${locationId}/agents/${agentId}/follow-up-sequences/${seq.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !seq.isActive }),
    })
    const { sequence } = await res.json()
    setSequences(prev => prev.map(s => s.id === seq.id ? sequence : s))
  }

  async function deleteSequence(id: string) {
    await fetch(`/api/locations/${locationId}/agents/${agentId}/follow-up-sequences/${id}`, { method: 'DELETE' })
    setSequences(prev => prev.filter(s => s.id !== id))
  }

  async function createSequence(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    const res = await fetch(`/api/locations/${locationId}/agents/${agentId}/follow-up-sequences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, steps: newSteps }),
    })
    const { sequence } = await res.json()
    setSequences(prev => [...prev, sequence])
    setNewName('')
    setNewSteps([{ stepNumber: 1, delayHours: 24, message: '' }])
    setCreating(false)
  }

  function addStep() {
    setNewSteps(prev => [...prev, { stepNumber: prev.length + 1, delayHours: 24, message: '' }])
  }

  function updateStep(idx: number, field: keyof FollowUpStep, value: string | number) {
    setNewSteps(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
  }

  function removeStep(idx: number) {
    setNewSteps(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepNumber: i + 1 })))
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold mb-2">Follow-Up Sequences</h1>
        <p className="text-zinc-400 text-sm mb-8">Automatic messages sent to non-responsive contacts.</p>

        {/* Existing sequences */}
        {sequences.length > 0 && (
          <div className="space-y-4 mb-8">
            {sequences.map(seq => (
              <div key={seq.id} className="rounded-lg border border-zinc-800 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-medium text-zinc-200">{seq.name}</p>
                    <button
                      onClick={() => toggleActive(seq)}
                      className={`relative inline-flex h-4 w-8 shrink-0 rounded-full border-2 border-transparent transition-colors ${seq.isActive ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                    >
                      <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition ${seq.isActive ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  <button
                    onClick={() => deleteSequence(seq.id)}
                    className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
                  >
                    Delete
                  </button>
                </div>
                <div className="space-y-2">
                  {seq.steps.map(step => (
                    <div key={step.id} className="flex items-start gap-3 text-xs text-zinc-500 pl-2 border-l border-zinc-800">
                      <span className="shrink-0 font-medium text-zinc-400">Step {step.stepNumber}</span>
                      <span className="shrink-0">after {step.delayHours}h</span>
                      <span className="text-zinc-600 line-clamp-1">{step.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create new sequence */}
        <div className="rounded-lg border border-zinc-800 p-4">
          <p className="text-sm font-medium text-zinc-300 mb-4">New Sequence</p>
          <form onSubmit={createSequence} className="space-y-4">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Sequence name"
              required
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />

            <div className="space-y-3">
              {newSteps.map((step, idx) => (
                <div key={idx} className="rounded-lg border border-zinc-700 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-400">Step {step.stepNumber}</span>
                    {newSteps.length > 1 && (
                      <button type="button" onClick={() => removeStep(idx)} className="text-xs text-zinc-600 hover:text-red-400">Remove</button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-zinc-500 shrink-0">Send after</label>
                    <input
                      type="number"
                      min={1}
                      value={step.delayHours}
                      onChange={e => updateStep(idx, 'delayHours', Number(e.target.value))}
                      className="w-20 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-zinc-500"
                    />
                    <span className="text-xs text-zinc-500">hours</span>
                  </div>
                  <textarea
                    value={step.message}
                    onChange={e => updateStep(idx, 'message', e.target.value)}
                    placeholder="Message to send…"
                    required
                    rows={2}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={addStep}
                className="text-sm text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg px-3 py-1.5 transition-colors"
              >
                + Add Step
              </button>
              <button
                type="submit"
                disabled={creating}
                className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create Sequence'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
