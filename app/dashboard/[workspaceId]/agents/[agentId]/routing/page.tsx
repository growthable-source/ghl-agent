'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import TagCombobox from '@/components/TagCombobox'

type RuleType = 'ALL' | 'TAG' | 'PIPELINE_STAGE' | 'KEYWORD'

interface Clause {
  ruleType: RuleType
  values: string[]
  negate?: boolean
}

interface ClauseGroup {
  clauses: Clause[]
}

interface Conditions {
  // Groups are OR'd; within a group, clauses are AND'd. We always work with
  // the groups shape in this builder — legacy AND-only rules are normalised
  // into a single-group on load.
  groups?: ClauseGroup[]
  clauses?: Clause[]
}

interface RoutingRule {
  id: string
  ruleType: RuleType
  value: string | null
  priority: number
  conditions: Conditions | null
}

const RULE_TYPE_OPTIONS: { value: RuleType; label: string; hint: string; takesValues: boolean; supportsNegate: boolean }[] = [
  { value: 'ALL',            label: 'All inbound messages',       hint: 'Matches every message.',                                   takesValues: false, supportsNegate: false },
  { value: 'TAG',            label: 'Contact has tag',             hint: 'Matches if the contact has ANY of the listed tags.',       takesValues: true,  supportsNegate: true  },
  { value: 'PIPELINE_STAGE', label: 'Contact in pipeline stage',   hint: 'Matches if the contact is in ANY of the listed stages.',   takesValues: true,  supportsNegate: true  },
  { value: 'KEYWORD',        label: 'Message contains keyword',    hint: 'Matches if the inbound message contains ANY keyword.',     takesValues: true,  supportsNegate: true  },
]

function takesValues(t: RuleType) {
  return RULE_TYPE_OPTIONS.find(o => o.value === t)?.takesValues ?? false
}
function supportsNegate(t: RuleType) {
  return RULE_TYPE_OPTIONS.find(o => o.value === t)?.supportsNegate ?? false
}
function labelForType(t: RuleType, negate?: boolean) {
  const base = RULE_TYPE_OPTIONS.find(o => o.value === t)?.label ?? t
  if (!negate) return base
  // Flip the wording so the rendered rule reads naturally.
  if (t === 'TAG') return 'Contact does NOT have tag'
  if (t === 'PIPELINE_STAGE') return 'Contact NOT in pipeline stage'
  if (t === 'KEYWORD') return 'Message does NOT contain keyword'
  return `NOT ${base}`
}

/**
 * Normalise any of the three stored rule shapes into the groups[] form the
 * builder wants to display / edit.
 *   - conditions.groups present → use as-is
 *   - conditions.clauses present → single group
 *   - legacy ruleType + value → single group, single clause
 */
function ruleToGroups(rule: RoutingRule): ClauseGroup[] {
  if (rule.conditions?.groups && rule.conditions.groups.length > 0) {
    return rule.conditions.groups
  }
  if (rule.conditions?.clauses && rule.conditions.clauses.length > 0) {
    return [{ clauses: rule.conditions.clauses }]
  }
  return [{
    clauses: [{
      ruleType: rule.ruleType,
      values: rule.value
        ? (rule.ruleType === 'KEYWORD' ? rule.value.split(',').map(s => s.trim()).filter(Boolean) : [rule.value])
        : [],
    }],
  }]
}

export default function RoutingPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [loading, setLoading] = useState(true)
  const [rules, setRules] = useState<RoutingRule[]>([])
  const [locationId, setLocationId] = useState<string>('')

  // Builder state for a NEW rule — always works with groups[] even when a
  // rule ends up having just one group (the common AND-only case).
  const [builderGroups, setBuilderGroups] = useState<ClauseGroup[]>([
    { clauses: [{ ruleType: 'TAG', values: [] }] },
  ])
  // Per-clause search text for TagCombobox (keyed by "groupIdx:clauseIdx") so
  // keystrokes in one clause's picker don't leak into another.
  const [searchText, setSearchText] = useState<Record<string, string>>({})
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
    // Clean each group: drop clauses that require values but have none, drop
    // groups that end up empty. This lets users leave a half-built OR branch
    // while filling the other — we just won't save the empty one.
    const cleanedGroups: ClauseGroup[] = builderGroups
      .map(g => ({
        clauses: g.clauses
          .map(c => ({
            ruleType: c.ruleType,
            values: takesValues(c.ruleType) ? c.values.filter(v => v && v.trim()) : [],
            ...(c.negate && supportsNegate(c.ruleType) ? { negate: true } : {}),
          }))
          .filter(c => !takesValues(c.ruleType) || c.values.length > 0),
      }))
      .filter(g => g.clauses.length > 0)

    if (cleanedGroups.length === 0) return

    setSaving(true)
    // Backward-compat wire format: single-group rules still send `clauses`
    // (the older evaluator path) so rollouts are safe. Multi-group sends
    // `groups`. Both are accepted server-side.
    const payload = cleanedGroups.length === 1
      ? { conditions: { clauses: cleanedGroups[0].clauses } }
      : { conditions: { groups: cleanedGroups } }

    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/routing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const { rule } = await res.json()
    setRules(prev => [...prev, rule].sort((a, b) => a.priority - b.priority))
    setBuilderGroups([{ clauses: [{ ruleType: 'TAG', values: [] }] }])
    setSearchText({})
    setSaving(false)
  }

  async function deleteRule(id: string) {
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/routing/${id}`, { method: 'DELETE' })
    setRules(prev => prev.filter(r => r.id !== id))
  }

  // ── Builder editing helpers ───────────────────────────────────────────
  function updateClause(gi: number, ci: number, patch: Partial<Clause>) {
    setBuilderGroups(prev => prev.map((g, gIdx) =>
      gIdx !== gi ? g : {
        clauses: g.clauses.map((c, cIdx) => cIdx === ci ? { ...c, ...patch } : c),
      },
    ))
  }
  function addClause(gi: number) {
    setBuilderGroups(prev => prev.map((g, gIdx) =>
      gIdx !== gi ? g : { clauses: [...g.clauses, { ruleType: 'TAG', values: [] }] },
    ))
  }
  function removeClause(gi: number, ci: number) {
    setBuilderGroups(prev => prev.map((g, gIdx) =>
      gIdx !== gi ? g : { clauses: g.clauses.filter((_, cIdx) => cIdx !== ci) },
    ).filter(g => g.clauses.length > 0))
  }
  function addGroup() {
    setBuilderGroups(prev => [...prev, { clauses: [{ ruleType: 'TAG', values: [] }] }])
  }
  function removeGroup(gi: number) {
    setBuilderGroups(prev => prev.filter((_, gIdx) => gIdx !== gi))
  }
  function addValue(gi: number, ci: number, value: string) {
    const v = value.trim()
    if (!v) return
    setBuilderGroups(prev => prev.map((g, gIdx) =>
      gIdx !== gi ? g : {
        clauses: g.clauses.map((c, cIdx) => {
          if (cIdx !== ci) return c
          if (c.values.includes(v)) return c
          return { ...c, values: [...c.values, v] }
        }),
      },
    ))
  }
  function removeValue(gi: number, ci: number, value: string) {
    setBuilderGroups(prev => prev.map((g, gIdx) =>
      gIdx !== gi ? g : {
        clauses: g.clauses.map((c, cIdx) =>
          cIdx !== ci ? c : { ...c, values: c.values.filter(v => v !== value) },
        ),
      },
    ))
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <p className="text-sm text-zinc-400">
        These rules decide which conversations this agent runs on. Rules are evaluated in priority order — the first matching rule deploys the agent. Inside a rule: conditions in the same group must all match (AND), any group matching wins (OR), and each condition can be negated (NOT).
      </p>

      {/* Existing rules */}
      {rules.length > 0 && (
        <div className="space-y-3">
          {rules.map(rule => {
            const groups = ruleToGroups(rule)
            return (
              <div key={rule.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-zinc-600 font-mono">priority {rule.priority}</span>
                      {groups.length > 1 && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400/80">
                          {groups.length} OR groups
                        </span>
                      )}
                    </div>
                    {groups.map((group, gi) => (
                      <div key={gi} className="space-y-1.5">
                        {gi > 0 && (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-px bg-amber-500/20" />
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">or</span>
                            <div className="flex-1 h-px bg-amber-500/20" />
                          </div>
                        )}
                        {group.clauses.map((cl, ci) => (
                          <div key={ci} className="flex items-start gap-2 flex-wrap">
                            {ci > 0 && <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 mt-1">and</span>}
                            <span className={`text-xs font-medium rounded px-2 py-0.5 ${
                              cl.negate ? 'bg-red-500/10 text-red-300 border border-red-500/20' : 'bg-zinc-800 text-zinc-300'
                            }`}>
                              {labelForType(cl.ruleType, cl.negate)}
                            </span>
                            {cl.values.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {cl.values.map(v => (
                                  <span key={v} className="text-xs bg-zinc-900 border border-zinc-800 text-zinc-300 rounded px-2 py-0.5 break-all">
                                    {v}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
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
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between flex-wrap gap-2">
          <p className="text-sm font-medium text-zinc-200">Add rule</p>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            group = AND · between groups = OR
          </span>
        </div>

        <div className="p-5 space-y-4">
          {builderGroups.map((group, gi) => (
            <div key={gi}>
              {/* OR divider between groups */}
              {gi > 0 && (
                <div className="flex items-center gap-2 py-3">
                  <div className="flex-1 h-px bg-amber-500/30" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">or</span>
                  <div className="flex-1 h-px bg-amber-500/30" />
                </div>
              )}

              <div className="rounded-lg border border-amber-500/10 bg-amber-500/[0.02] p-3 space-y-3">
                {builderGroups.length > 1 && (
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400/70">
                      Group {gi + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeGroup(gi)}
                      className="text-[11px] text-zinc-500 hover:text-red-400 transition-colors"
                    >
                      Remove group
                    </button>
                  </div>
                )}

                {group.clauses.map((clause, ci) => {
                  const key = `${gi}:${ci}`
                  return (
                    <div key={ci} className="space-y-2">
                      {ci > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-px bg-zinc-800" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">and</span>
                          <div className="flex-1 h-px bg-zinc-800" />
                        </div>
                      )}

                      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-3">
                        {/* Row 1 — type selector + (optional) NOT toggle + remove.
                            flex-wrap so it collapses gracefully on narrow widths
                            instead of clipping the remove button. */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <select
                            value={clause.ruleType}
                            onChange={e => updateClause(gi, ci, { ruleType: e.target.value as RuleType, values: [], negate: false })}
                            className="flex-1 min-w-[180px] bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                          >
                            {RULE_TYPE_OPTIONS.map(o => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>

                          {supportsNegate(clause.ruleType) && (
                            <button
                              type="button"
                              onClick={() => updateClause(gi, ci, { negate: !clause.negate })}
                              title={clause.negate
                                ? 'Currently negated — click to remove NOT'
                                : 'Invert this condition (DOES NOT HAVE / NOT IN / NOT CONTAINS)'}
                              className={`shrink-0 text-xs font-medium rounded-lg px-2.5 py-2 border transition-colors ${
                                clause.negate
                                  ? 'border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20'
                                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
                              }`}
                            >
                              {clause.negate ? 'NOT ✓' : 'NOT'}
                            </button>
                          )}

                          {(group.clauses.length > 1 || builderGroups.length > 1) && (
                            <button
                              type="button"
                              onClick={() => removeClause(gi, ci)}
                              className="shrink-0 text-xs text-zinc-500 hover:text-red-400 px-2 py-2 transition-colors"
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
                                  <span key={v} className="flex items-center gap-1 bg-zinc-800 text-zinc-300 text-xs rounded-full pl-2.5 pr-1 py-1 max-w-full break-all">
                                    {v}
                                    <button
                                      type="button"
                                      onClick={() => removeValue(gi, ci, v)}
                                      className="w-4 h-4 flex items-center justify-center rounded-full text-zinc-500 hover:text-red-400 hover:bg-zinc-700 transition-colors shrink-0"
                                    >
                                      ×
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}

                            {clause.ruleType === 'TAG' && locationId ? (
                              // Controlled search text per-clause. onChange
                              // updates the searchable string (no side effects);
                              // onSelect fires only on pick/create/Enter and
                              // adds the tag to this clause's values.
                              <TagCombobox
                                workspaceId={workspaceId}
                                locationId={locationId}
                                value={searchText[key] ?? ''}
                                onChange={v => setSearchText(prev => ({ ...prev, [key]: v }))}
                                onSelect={v => {
                                  addValue(gi, ci, v)
                                  setSearchText(prev => ({ ...prev, [key]: '' }))
                                }}
                                clearOnSelect
                                placeholder="Search tags — pick one or press Enter to create"
                              />
                            ) : (
                              <ValueInput
                                placeholder={
                                  clause.ruleType === 'PIPELINE_STAGE' ? 'Pipeline stage ID and Enter' :
                                  'Keyword and Enter (e.g. price, cost)'
                                }
                                onSubmit={v => addValue(gi, ci, v)}
                              />
                            )}

                            <p className="text-[11px] text-zinc-600">
                              Any of these {clause.values.length > 0 ? 'matches' : 'will match'} (OR within the condition)
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}

                <button
                  type="button"
                  onClick={() => addClause(gi)}
                  className="w-full border border-dashed border-zinc-700 hover:border-zinc-500 rounded-lg py-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  + Add condition (AND) to this group
                </button>
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={addGroup}
            className="w-full border border-dashed border-amber-500/30 hover:border-amber-500/60 rounded-lg py-2 text-xs text-amber-400/80 hover:text-amber-300 transition-colors"
          >
            + Add OR group
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
