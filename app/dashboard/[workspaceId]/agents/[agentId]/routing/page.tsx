'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import TagCombobox from '@/components/TagCombobox'

type RuleType = 'ALL' | 'TAG' | 'PIPELINE_STAGE' | 'KEYWORD'

interface Clause {
  ruleType: RuleType
  values: string[]
}

interface Conditions {
  clauses: Clause[]
}

interface RoutingRule {
  id: string
  ruleType: RuleType
  value: string | null
  priority: number
  conditions: Conditions | null
}

const RULE_TYPE_OPTIONS: { value: RuleType; label: string; hint: string; takesValues: boolean }[] = [
  { value: 'ALL',            label: 'All inbound messages',   hint: 'Matches every message — use to catch everything.', takesValues: false },
  { value: 'TAG',            label: 'Contact has tag',         hint: 'Matches if the contact has ANY of the listed tags.', takesValues: true },
  { value: 'PIPELINE_STAGE', label: 'Contact in pipeline stage', hint: 'Matches if the contact is in ANY of the listed stages.', takesValues: true },
  { value: 'KEYWORD',        label: 'Message contains keyword', hint: 'Matches if the inbound message contains ANY of the keywords.', takesValues: true },
]

// Display a rule as one-or-more clauses joined by AND.
// Legacy rules (no `conditions`) normalise into a single-clause compound.
function ruleToClauses(rule: RoutingRule): Clause[] {
  if (rule.conditions?.clauses && rule.conditions.clauses.length > 0) {
    return rule.conditions.clauses
  }
  return [{
    ruleType: rule.ruleType,
    values: rule.value
      ? (rule.ruleType === 'KEYWORD' ? rule.value.split(',').map(s => s.trim()).filter(Boolean) : [rule.value])
      : [],
  }]
}

function takesValues(t: RuleType) {
  return RULE_TYPE_OPTIONS.find(o => o.value === t)?.takesValues ?? false
}

function labelForType(t: RuleType) {
  return RULE_TYPE_OPTIONS.find(o => o.value === t)?.label ?? t
}

export default function RoutingPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [loading, setLoading] = useState(true)
  const [rules, setRules] = useState<RoutingRule[]>([])
  const [locationId, setLocationId] = useState<string>('')

  // Builder state for a NEW rule (composed of N clauses joined by AND)
  const [builderClauses, setBuilderClauses] = useState<Clause[]>([
    { ruleType: 'ALL', values: [] },
  ])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      .then(r => r.json())
      .then(({ agent }) => {
        setRules(agent.routingRules ?? [])
        setLocationId(agent.locationId || '')
      })
      .finally(() => setLoading(false))
  }, [workspaceId, agentId])

  async function addRule() {
    const cleaned = builderClauses
      .map(c => ({
        ruleType: c.ruleType,
        values: takesValues(c.ruleType) ? c.values.filter(v => v && v.trim()) : [],
      }))
      // Drop clauses that require values but have none — otherwise they'd
      // match nothing and silently break the whole rule.
      .filter(c => !takesValues(c.ruleType) || c.values.length > 0)

    if (cleaned.length === 0) return

    setSaving(true)
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/routing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditions: { clauses: cleaned } }),
    })
    const { rule } = await res.json()
    setRules(prev => [...prev, rule].sort((a, b) => a.priority - b.priority))
    setBuilderClauses([{ ruleType: 'ALL', values: [] }])
    setSaving(false)
  }

  async function deleteRule(id: string) {
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/routing/${id}`, { method: 'DELETE' })
    setRules(prev => prev.filter(r => r.id !== id))
  }

  // ── Builder editing helpers ───────────────────────────────────────────
  function updateClause(i: number, patch: Partial<Clause>) {
    setBuilderClauses(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c))
  }
  function addClause() {
    setBuilderClauses(prev => [...prev, { ruleType: 'TAG', values: [] }])
  }
  function removeClause(i: number) {
    setBuilderClauses(prev => prev.filter((_, idx) => idx !== i))
  }
  function addValue(i: number, value: string) {
    const v = value.trim()
    if (!v) return
    setBuilderClauses(prev => prev.map((c, idx) => {
      if (idx !== i) return c
      if (c.values.includes(v)) return c
      return { ...c, values: [...c.values, v] }
    }))
  }
  function removeValue(i: number, value: string) {
    setBuilderClauses(prev => prev.map((c, idx) =>
      idx === i ? { ...c, values: c.values.filter(v => v !== value) } : c
    ))
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  return (
    <div className="p-8 max-w-2xl space-y-6">
      <p className="text-sm text-zinc-400">
        These rules decide which conversations this agent runs on. Rules are evaluated in priority order — the first matching rule deploys the agent. Within a rule, all conditions must match (AND). Within a condition, any value can match (OR).
      </p>

      {/* Existing rules */}
      {rules.length > 0 && (
        <div className="space-y-3">
          {rules.map(rule => {
            const clauses = ruleToClauses(rule)
            return (
              <div key={rule.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-600 font-mono">priority {rule.priority}</span>
                    </div>
                    {clauses.map((cl, i) => (
                      <div key={i} className="flex items-start gap-2 flex-wrap">
                        {i > 0 && <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 mt-1">and</span>}
                        <span className="text-xs font-medium text-zinc-300 bg-zinc-800 rounded px-2 py-0.5">
                          {labelForType(cl.ruleType)}
                        </span>
                        {cl.values.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {cl.values.map(v => (
                              <span key={v} className="text-xs bg-zinc-900 border border-zinc-800 text-zinc-300 rounded px-2 py-0.5">
                                {v}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => deleteRule(rule.id)}
                    className="text-xs text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Builder */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-200">Add rule</p>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            all conditions must match
          </span>
        </div>

        <div className="p-5 space-y-3">
          {builderClauses.map((clause, i) => (
            <div key={i} className="space-y-2">
              {i > 0 && (
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-zinc-800" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">and</span>
                  <div className="flex-1 h-px bg-zinc-800" />
                </div>
              )}

              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <select
                    value={clause.ruleType}
                    onChange={e => updateClause(i, { ruleType: e.target.value as RuleType, values: [] })}
                    className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                  >
                    {RULE_TYPE_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  {builderClauses.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeClause(i)}
                      className="text-xs text-zinc-500 hover:text-red-400 px-2 py-2 transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>

                {takesValues(clause.ruleType) && (
                  <>
                    {clause.values.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {clause.values.map(v => (
                          <span key={v} className="flex items-center gap-1 bg-zinc-800 text-zinc-300 text-xs rounded-full pl-2.5 pr-1 py-1">
                            {v}
                            <button
                              type="button"
                              onClick={() => removeValue(i, v)}
                              className="w-4 h-4 flex items-center justify-center rounded-full text-zinc-500 hover:text-red-400 hover:bg-zinc-700 transition-colors"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    {clause.ruleType === 'TAG' && locationId ? (
                      <TagCombobox
                        workspaceId={workspaceId}
                        locationId={locationId}
                        value=""
                        onChange={v => { if (v) addValue(i, v) }}
                        placeholder="Search existing tags or create a new one"
                      />
                    ) : (
                      <ValueInput
                        placeholder={
                          clause.ruleType === 'PIPELINE_STAGE' ? 'Pipeline stage ID and Enter' :
                          'Keyword and Enter (e.g. price, cost)'
                        }
                        onSubmit={v => addValue(i, v)}
                      />
                    )}

                    <p className="text-[11px] text-zinc-600">
                      Any of these {clause.values.length > 0 ? 'matches' : 'will match'} (OR)
                    </p>
                  </>
                )}
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addClause}
            className="w-full border border-dashed border-zinc-700 hover:border-zinc-500 rounded-lg py-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            + Add condition (AND)
          </button>

          <button
            type="button"
            onClick={addRule}
            disabled={saving}
            className="w-full inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save rule'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Small inline "type a value, press Enter" input used for KEYWORD and
// PIPELINE_STAGE since they don't have pickers.
function ValueInput({ placeholder, onSubmit }: { placeholder: string; onSubmit: (v: string) => void }) {
  const [v, setV] = useState('')
  return (
    <input
      type="text"
      value={v}
      onChange={e => setV(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter' && v.trim()) {
          e.preventDefault()
          onSubmit(v.trim())
          setV('')
        }
      }}
      placeholder={placeholder}
      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
    />
  )
}
