'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type StopConditionType = 'APPOINTMENT_BOOKED' | 'KEYWORD' | 'MESSAGE_COUNT' | 'OPPORTUNITY_STAGE'

interface StopCondition {
  id: string
  conditionType: StopConditionType
  value: string | null
  pauseAgent: boolean
}

const TYPE_LABELS: Record<StopConditionType, string> = {
  APPOINTMENT_BOOKED: 'Appointment Booked',
  KEYWORD: 'Keyword',
  MESSAGE_COUNT: 'Message Count',
  OPPORTUNITY_STAGE: 'Pipeline Stage',
}

export default function GoalsPage() {
  const params = useParams()
  const locationId = params.locationId as string
  const agentId = params.agentId as string

  const [conditions, setConditions] = useState<StopCondition[]>([])
  const [loading, setLoading] = useState(true)

  const [condType, setCondType] = useState<StopConditionType>('APPOINTMENT_BOOKED')
  const [condValue, setCondValue] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    fetch(`/api/locations/${locationId}/agents/${agentId}/stop-conditions`)
      .then(r => r.json())
      .then(({ conditions }) => setConditions(conditions ?? []))
      .finally(() => setLoading(false))
  }, [locationId, agentId])

  async function addCondition(e: React.FormEvent) {
    e.preventDefault()
    setAdding(true)
    const res = await fetch(`/api/locations/${locationId}/agents/${agentId}/stop-conditions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditionType: condType, value: condValue || null }),
    })
    const { condition } = await res.json()
    setConditions(prev => [...prev, condition])
    setCondValue('')
    setAdding(false)
  }

  async function deleteCondition(id: string) {
    await fetch(`/api/locations/${locationId}/agents/${agentId}/stop-conditions/${id}`, { method: 'DELETE' })
    setConditions(prev => prev.filter(c => c.id !== id))
  }

  const needsValue = condType === 'KEYWORD' || condType === 'MESSAGE_COUNT' || condType === 'OPPORTUNITY_STAGE'

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold mb-2">Goals & Stop Conditions</h1>
        <p className="text-zinc-400 text-sm mb-8">Define when the agent should stop and pause the conversation.</p>

        {/* Existing conditions */}
        {conditions.length > 0 && (
          <div className="space-y-2 mb-8">
            {conditions.map(cond => (
              <div key={cond.id} className="flex items-center justify-between rounded-lg border border-zinc-800 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium bg-zinc-800 text-zinc-300 rounded px-2 py-0.5">
                    {TYPE_LABELS[cond.conditionType]}
                  </span>
                  {cond.value && <span className="text-sm text-zinc-400">{cond.value}</span>}
                </div>
                <button
                  onClick={() => deleteCondition(cond.id)}
                  className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add form */}
        <div className="rounded-lg border border-zinc-800 p-4">
          <p className="text-sm font-medium text-zinc-300 mb-4">Add Stop Condition</p>
          <form onSubmit={addCondition} className="space-y-3">
            <select
              value={condType}
              onChange={e => { setCondType(e.target.value as StopConditionType); setCondValue('') }}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
            >
              <option value="APPOINTMENT_BOOKED">Appointment Booked</option>
              <option value="KEYWORD">Keyword</option>
              <option value="MESSAGE_COUNT">Message Count</option>
              <option value="OPPORTUNITY_STAGE">Pipeline Stage</option>
            </select>

            {needsValue && (
              <input
                type={condType === 'MESSAGE_COUNT' ? 'number' : 'text'}
                value={condValue}
                onChange={e => setCondValue(e.target.value)}
                placeholder={
                  condType === 'KEYWORD' ? 'e.g. stop,unsubscribe,cancel (comma separated)' :
                  condType === 'MESSAGE_COUNT' ? 'e.g. 10' :
                  'Pipeline stage ID'
                }
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            )}

            <button
              type="submit"
              disabled={adding}
              className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {adding ? 'Adding…' : 'Add Condition'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
