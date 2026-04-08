'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type RuleType = 'ALL' | 'TAG' | 'PIPELINE_STAGE' | 'KEYWORD'

interface RoutingRule {
  id: string
  ruleType: RuleType
  value: string | null
  priority: number
}

export default function RulesPage() {
  const params = useParams()
  const locationId = params.locationId as string
  const agentId = params.agentId as string

  const [loading, setLoading] = useState(true)
  const [rules, setRules] = useState<RoutingRule[]>([])
  const [ruleType, setRuleType] = useState<RuleType>('ALL')
  const [ruleValue, setRuleValue] = useState('')
  const [addingRule, setAddingRule] = useState(false)

  useEffect(() => {
    fetch(`/api/locations/${locationId}/agents/${agentId}`)
      .then(r => r.json())
      .then(({ agent }) => setRules(agent.routingRules ?? []))
      .finally(() => setLoading(false))
  }, [locationId, agentId])

  async function addRule(e: React.FormEvent) {
    e.preventDefault()
    setAddingRule(true)
    const res = await fetch(`/api/locations/${locationId}/agents/${agentId}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleType, value: ruleValue || null }),
    })
    const { rule } = await res.json()
    setRules(prev => [...prev, rule].sort((a, b) => a.priority - b.priority))
    setRuleType('ALL')
    setRuleValue('')
    setAddingRule(false)
  }

  async function deleteRule(id: string) {
    await fetch(`/api/locations/${locationId}/agents/${agentId}/rules/${id}`, { method: 'DELETE' })
    setRules(prev => prev.filter(r => r.id !== id))
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  return (
    <div className="p-8 max-w-2xl space-y-6">
      <p className="text-sm text-zinc-400">
        Rules are evaluated in priority order. The first matching rule activates this agent.
      </p>

      {rules.length > 0 && (
        <div className="space-y-2">
          {rules.map(rule => (
            <div key={rule.id} className="flex items-center justify-between rounded-lg border border-zinc-800 px-4 py-3">
              <div className="flex items-center gap-4">
                <span className="text-xs text-zinc-600 font-mono w-4">{rule.priority}</span>
                <span className="text-xs font-medium text-zinc-300 bg-zinc-800 rounded px-2 py-0.5">{rule.ruleType}</span>
                {rule.value && <span className="text-sm text-zinc-400">{rule.value}</span>}
              </div>
              <button
                onClick={() => deleteRule(rule.id)}
                className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 p-5">
        <p className="text-sm font-medium text-zinc-300 mb-4">Add Rule</p>
        <form onSubmit={addRule} className="space-y-3">
          <select
            value={ruleType}
            onChange={e => { setRuleType(e.target.value as RuleType); setRuleValue('') }}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
          >
            <option value="ALL">All inbound messages</option>
            <option value="TAG">Contact has tag</option>
            <option value="PIPELINE_STAGE">Contact in pipeline stage</option>
            <option value="KEYWORD">Message contains keyword(s)</option>
          </select>
          {ruleType !== 'ALL' && (
            <input
              type="text"
              value={ruleValue}
              onChange={e => setRuleValue(e.target.value)}
              placeholder={
                ruleType === 'TAG' ? 'e.g. hot-lead' :
                ruleType === 'PIPELINE_STAGE' ? 'Pipeline stage ID' :
                'e.g. price, cost, how much (comma separated)'
              }
              required
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          )}
          <button
            type="submit"
            disabled={addingRule}
            className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            {addingRule ? 'Adding…' : 'Add Rule'}
          </button>
        </form>
      </div>
    </div>
  )
}
