'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type StopConditionType = 'APPOINTMENT_BOOKED' | 'KEYWORD' | 'MESSAGE_COUNT' | 'OPPORTUNITY_STAGE' | 'SENTIMENT'

interface StopCondition {
  id: string
  conditionType: StopConditionType
  value: string | null
  pauseAgent: boolean
  tagNeedsAttention: boolean
  enrollWorkflowId: string | null
  removeWorkflowId: string | null
}

interface WorkflowOption {
  id: string
  name: string
}

const TYPE_LABELS: Record<StopConditionType, string> = {
  APPOINTMENT_BOOKED: 'Appointment Booked',
  KEYWORD: 'Keyword',
  MESSAGE_COUNT: 'Message Count',
  OPPORTUNITY_STAGE: 'Pipeline Stage',
  SENTIMENT: 'Hostile / angry sentiment',
}

const TYPE_HINTS: Record<StopConditionType, string> = {
  APPOINTMENT_BOOKED: 'Stops the agent after a booking tool call completes.',
  KEYWORD: 'Exact substring match on the contact\'s inbound message.',
  MESSAGE_COUNT: 'Stops after the contact has sent N messages.',
  OPPORTUNITY_STAGE: 'Stops after an opportunity-stage move tool call.',
  SENTIMENT: 'Matches hostile language in the inbound message — hate, lawyer, refund now, unacceptable, profanity, etc. Add your own extra keywords below.',
}

function needsValueInput(t: StopConditionType): boolean {
  return t === 'KEYWORD' || t === 'MESSAGE_COUNT' || t === 'OPPORTUNITY_STAGE' || t === 'SENTIMENT'
}

export default function GoalsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [conditions, setConditions] = useState<StopCondition[]>([])
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([])
  const [workflowsError, setWorkflowsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Add-form state
  const [condType, setCondType] = useState<StopConditionType>('APPOINTMENT_BOOKED')
  const [condValue, setCondValue] = useState('')
  const [pauseAgent, setPauseAgent] = useState(true)
  const [tagNeedsAttention, setTagNeedsAttention] = useState(true)
  const [enrollWorkflowId, setEnrollWorkflowId] = useState('')
  const [removeWorkflowId, setRemoveWorkflowId] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/stop-conditions`)
        .then(r => r.json())
        .then(({ conditions }) => setConditions(conditions ?? [])),
      // Workflows — used by the per-condition enrol/remove pickers. Non-fatal;
      // if GHL isn't connected the pickers just show "No workflows available".
      fetch(`/api/workspaces/${workspaceId}/workflows`)
        .then(async r => {
          if (!r.ok) {
            const body = await r.json().catch(() => ({}))
            setWorkflowsError(body.error || `Couldn't load workflows (${r.status})`)
            return { workflows: [] }
          }
          return r.json()
        })
        .then(({ workflows }) => setWorkflows(workflows ?? []))
        .catch(err => setWorkflowsError(err?.message ?? 'Couldn\'t load workflows')),
    ]).finally(() => setLoading(false))
  }, [workspaceId, agentId])

  function resetAddForm() {
    setCondType('APPOINTMENT_BOOKED')
    setCondValue('')
    setPauseAgent(true)
    setTagNeedsAttention(true)
    setEnrollWorkflowId('')
    setRemoveWorkflowId('')
  }

  async function addCondition(e: React.FormEvent) {
    e.preventDefault()
    setAdding(true)
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/stop-conditions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conditionType: condType,
        value: condValue || null,
        pauseAgent,
        tagNeedsAttention,
        enrollWorkflowId: enrollWorkflowId || null,
        removeWorkflowId: removeWorkflowId || null,
      }),
    })
    const { condition } = await res.json()
    setConditions(prev => [...prev, condition])
    resetAddForm()
    setAdding(false)
  }

  async function patchCondition(id: string, patch: Partial<StopCondition>) {
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/stop-conditions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const { condition } = await res.json()
    setConditions(prev => prev.map(c => c.id === id ? condition : c))
  }

  async function deleteCondition(id: string) {
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/stop-conditions/${id}`, { method: 'DELETE' })
    setConditions(prev => prev.filter(c => c.id !== id))
  }

  const workflowLabel = (id: string | null): string => {
    if (!id) return ''
    return workflows.find(w => w.id === id)?.name ?? `Workflow ${id.slice(0, 8)}…`
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  return (
    <div className="p-8">
      <div className="max-w-3xl">
        <p className="text-sm text-zinc-400 mb-6">
          Define when the agent should stop and pause the conversation. Each condition can also
          flag the contact as <span className="font-mono text-zinc-300">needs-attention</span> and
          enrol or remove them from a GoHighLevel workflow the moment it trips.
        </p>

        {/* Existing conditions */}
        {conditions.length > 0 && (
          <div className="space-y-3 mb-8">
            {conditions.map(cond => {
              const enrollName = workflowLabel(cond.enrollWorkflowId)
              const removeName = workflowLabel(cond.removeWorkflowId)
              return (
                <div key={cond.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-medium rounded px-2 py-0.5 ${
                          cond.conditionType === 'SENTIMENT'
                            ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30'
                            : 'bg-zinc-800 text-zinc-300'
                        }`}>
                          {cond.conditionType === 'SENTIMENT' && '⚠️ '}
                          {TYPE_LABELS[cond.conditionType]}
                        </span>
                        {cond.value && (
                          <span className="text-xs text-zinc-400 font-mono break-all">{cond.value}</span>
                        )}
                        {!cond.pauseAgent && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                            flag-only · doesn&apos;t pause
                          </span>
                        )}
                      </div>

                      {/* Action chips — visible at a glance */}
                      <div className="flex flex-wrap gap-1.5">
                        {cond.pauseAgent && (
                          <span className="text-[11px] text-zinc-400 bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5">
                            Pauses agent
                          </span>
                        )}
                        {cond.tagNeedsAttention && (
                          <span className="text-[11px] text-amber-400/90 bg-amber-500/5 border border-amber-500/20 rounded px-2 py-0.5">
                            Tags needs-attention
                          </span>
                        )}
                        {enrollName && (
                          <span className="text-[11px] text-emerald-400/90 bg-emerald-500/5 border border-emerald-500/20 rounded px-2 py-0.5">
                            Enrol → {enrollName}
                          </span>
                        )}
                        {removeName && (
                          <span className="text-[11px] text-red-400/90 bg-red-500/5 border border-red-500/20 rounded px-2 py-0.5">
                            Remove ← {removeName}
                          </span>
                        )}
                      </div>

                      {/* Inline edit for the actions (no full edit form —
                          operators usually want to toggle actions on an
                          existing condition, not rewrite the whole rule). */}
                      <div className="pt-2 flex flex-wrap items-center gap-3">
                        <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={cond.pauseAgent}
                            onChange={e => patchCondition(cond.id, { pauseAgent: e.target.checked })}
                            className="accent-zinc-400"
                          />
                          Pause agent
                        </label>
                        <label className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={cond.tagNeedsAttention}
                            onChange={e => patchCondition(cond.id, { tagNeedsAttention: e.target.checked })}
                            className="accent-amber-400"
                          />
                          Tag needs-attention
                        </label>
                      </div>
                    </div>
                    <button
                      onClick={() => deleteCondition(cond.id)}
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

        {/* Add form */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden">
          <div className="px-5 py-3 border-b border-zinc-800">
            <p className="text-sm font-medium text-zinc-200">Add stop condition</p>
          </div>
          <form onSubmit={addCondition} className="p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Trigger</label>
              <select
                value={condType}
                onChange={e => { setCondType(e.target.value as StopConditionType); setCondValue('') }}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
              >
                {(Object.keys(TYPE_LABELS) as StopConditionType[]).map(t => (
                  <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                ))}
              </select>
              <p className="text-[11px] text-zinc-600 mt-1.5">{TYPE_HINTS[condType]}</p>
            </div>

            {needsValueInput(condType) && (
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">
                  {condType === 'MESSAGE_COUNT' ? 'Message limit' :
                    condType === 'SENTIMENT' ? 'Extra hostile keywords (optional)' :
                    condType === 'OPPORTUNITY_STAGE' ? 'Pipeline stage ID' :
                    'Keywords'}
                </label>
                <input
                  type={condType === 'MESSAGE_COUNT' ? 'number' : 'text'}
                  value={condValue}
                  onChange={e => setCondValue(e.target.value)}
                  placeholder={
                    condType === 'KEYWORD' ? 'e.g. stop,unsubscribe,cancel (comma separated)' :
                    condType === 'MESSAGE_COUNT' ? 'e.g. 10' :
                    condType === 'SENTIMENT' ? 'e.g. rip-off, unprofessional (comma separated) — added on top of the built-in hostile list' :
                    'Pipeline stage ID'
                  }
                  required={condType !== 'SENTIMENT'}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
              </div>
            )}

            {/* ── Actions ─────────────────────────────────────────────── */}
            <div className="pt-2 border-t border-zinc-800 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                When this condition trips
              </p>

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pauseAgent}
                  onChange={e => setPauseAgent(e.target.checked)}
                  className="mt-0.5 accent-zinc-400"
                />
                <span className="text-sm text-zinc-300 leading-snug">
                  Pause the agent
                  <span className="block text-[11px] text-zinc-500 mt-0.5">
                    Stops all further replies until a human resumes the conversation.
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tagNeedsAttention}
                  onChange={e => setTagNeedsAttention(e.target.checked)}
                  className="mt-0.5 accent-amber-400"
                />
                <span className="text-sm text-zinc-300 leading-snug">
                  Tag contact <span className="font-mono text-zinc-400">needs-attention</span>
                  <span className="block text-[11px] text-zinc-500 mt-0.5">
                    Surfaces the contact on the Needs Attention review page for a human to pick up.
                  </span>
                </span>
              </label>

              {/* Workflow pickers — only functional when GHL is connected + tokens include workflows.readonly. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">
                    Enrol contact into workflow
                    <span className="text-zinc-600 font-normal"> (optional)</span>
                  </label>
                  <select
                    value={enrollWorkflowId}
                    onChange={e => setEnrollWorkflowId(e.target.value)}
                    disabled={workflows.length === 0}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 disabled:opacity-50"
                  >
                    <option value="">— none —</option>
                    {workflows.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1.5">
                    Remove contact from workflow
                    <span className="text-zinc-600 font-normal"> (optional)</span>
                  </label>
                  <select
                    value={removeWorkflowId}
                    onChange={e => setRemoveWorkflowId(e.target.value)}
                    disabled={workflows.length === 0}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 disabled:opacity-50"
                  >
                    <option value="">— none —</option>
                    {workflows.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              {workflowsError && (
                <p className="text-[11px] text-amber-400">
                  {workflowsError} — connect GoHighLevel and reconnect with the <span className="font-mono">workflows.readonly</span> scope to use workflow actions.
                </p>
              )}
              {!workflowsError && workflows.length === 0 && (
                <p className="text-[11px] text-zinc-600">
                  No workflows found. Either GHL isn&apos;t connected or the location has no published workflows.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={adding}
              className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {adding ? 'Adding…' : 'Add condition'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
