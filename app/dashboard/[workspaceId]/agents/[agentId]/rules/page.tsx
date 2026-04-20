'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

/**
 * Detection rules — "IF the contact says X, THEN do Y."
 *
 * Y can now be any of several actions: update a field, add/remove tags,
 * enrol in a workflow, remove from a workflow, change opportunity
 * status/value, mark DND. The form picks the action first; the
 * parameter panel that follows changes based on that choice.
 */

interface AgentRule {
  id: string
  name: string
  conditionDescription: string
  examples: string[]
  actionType: string
  actionParams: Record<string, any> | null
  targetFieldKey: string
  targetValue: string
  overwrite: boolean
  isActive: boolean
  order: number
}

interface ContactField {
  id: string
  name: string
  fieldKey: string
  dataType: string
  group: string
}

interface Workflow { id: string; name: string }

type ActionType =
  | 'update_contact_field'
  | 'update_contact_tags'
  | 'remove_contact_tags'
  | 'add_to_workflow'
  | 'remove_from_workflow'
  | 'opportunity_status'
  | 'opportunity_value'
  | 'dnd_channel'

const ACTION_LABELS: Record<ActionType, { label: string; hint: string }> = {
  update_contact_field:  { label: 'Update contact field',          hint: 'Write a value to a standard or custom field' },
  update_contact_tags:   { label: 'Add tag(s) to contact',          hint: 'Apply one or more tags' },
  remove_contact_tags:   { label: 'Remove tag(s) from contact',     hint: 'Strip tags off the contact' },
  add_to_workflow:       { label: 'Enrol contact in workflow(s)',   hint: 'Add to one or more GHL workflows' },
  remove_from_workflow:  { label: 'Remove contact from workflow(s)',hint: 'Remove from GHL workflows' },
  opportunity_status:    { label: 'Change opportunity status',      hint: 'Mark an opp as won / lost / abandoned / open' },
  opportunity_value:     { label: 'Set opportunity value',          hint: 'Update the monetary value of the opp' },
  dnd_channel:           { label: 'Mark contact as Do Not Disturb', hint: 'Block the channel this conversation is on (or a specific one)' },
}

const OPPORTUNITY_STATUSES = [
  { value: 'won',       label: 'Won' },
  { value: 'lost',      label: 'Lost' },
  { value: 'abandoned', label: 'Abandoned' },
  { value: 'open',      label: 'Open' },
]

const DND_CHANNELS = [
  { value: '',          label: 'Current conversation channel' },
  { value: 'SMS',       label: 'SMS' },
  { value: 'Email',     label: 'Email' },
  { value: 'WhatsApp',  label: 'WhatsApp' },
  { value: 'FB',        label: 'Facebook Messenger' },
  { value: 'IG',        label: 'Instagram DMs' },
  { value: 'GMB',       label: 'Google Business' },
  { value: 'Live_Chat', label: 'Live Chat' },
]

const emptyForm = {
  name: '',
  conditionDescription: '',
  examples: [] as string[],
  actionType: 'update_contact_field' as ActionType,
  // update_contact_field-only
  targetFieldKey: '',
  targetValue: '',
  overwrite: false,
  // per-action params bag
  actionParams: {} as Record<string, any>,
  isActive: true,
  newExample: '',
  newTag: '',
}

export default function RulesPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [rules, setRules] = useState<AgentRule[]>([])
  const [contactFields, setContactFields] = useState<ContactField[]>([])
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [workflowsError, setWorkflowsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/rules`)
        .then(r => r.json())
        .then(({ rules }) => setRules(rules ?? [])),
      fetch(`/api/workspaces/${workspaceId}/contact-fields`)
        .then(r => r.json())
        .then(({ fields }) => setContactFields(fields ?? []))
        .catch(() => {}),
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

  function updateForm<K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function updateActionParams(patch: Record<string, any>) {
    setForm(prev => ({ ...prev, actionParams: { ...prev.actionParams, ...patch } }))
  }

  function addExample() {
    const ex = form.newExample.trim()
    if (!ex) return
    setForm(prev => ({ ...prev, examples: [...prev.examples, ex], newExample: '' }))
  }
  function removeExample(i: number) {
    setForm(prev => ({ ...prev, examples: prev.examples.filter((_, idx) => idx !== i) }))
  }

  function addTagParam() {
    const tag = form.newTag.trim()
    if (!tag) return
    const current: string[] = form.actionParams.tags ?? []
    if (current.includes(tag)) return
    updateActionParams({ tags: [...current, tag] })
    updateForm('newTag', '')
  }
  function removeTagParam(t: string) {
    const current: string[] = form.actionParams.tags ?? []
    updateActionParams({ tags: current.filter(x => x !== t) })
  }

  function toggleWorkflow(wf: Workflow) {
    const currentIds: string[] = form.actionParams.workflowIds ?? []
    const on = currentIds.includes(wf.id)
    const nextIds = on ? currentIds.filter(x => x !== wf.id) : [...currentIds, wf.id]
    const nextNames = workflows.filter(w => nextIds.includes(w.id)).map(w => w.name)
    updateActionParams({ workflowIds: nextIds, workflowNames: nextNames })
  }

  function startEdit(r: AgentRule) {
    setEditingId(r.id)
    setForm({
      name: r.name,
      conditionDescription: r.conditionDescription,
      examples: r.examples ?? [],
      actionType: (r.actionType as ActionType) ?? 'update_contact_field',
      targetFieldKey: r.targetFieldKey ?? '',
      targetValue: r.targetValue ?? '',
      overwrite: r.overwrite ?? false,
      actionParams: r.actionParams ?? {},
      isActive: r.isActive,
      newExample: '',
      newTag: '',
    })
    setShowForm(true)
    setTimeout(() => document.getElementById('rule-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.conditionDescription.trim()) return
    // Action-specific required-param validation
    if (form.actionType === 'update_contact_field' && (!form.targetFieldKey || !form.targetValue.trim())) return
    if ((form.actionType === 'update_contact_tags' || form.actionType === 'remove_contact_tags') &&
        !(form.actionParams.tags?.length)) return
    if ((form.actionType === 'add_to_workflow' || form.actionType === 'remove_from_workflow') &&
        !(form.actionParams.workflowIds?.length)) return
    if (form.actionType === 'opportunity_status' && !form.actionParams.status) return
    if (form.actionType === 'opportunity_value' &&
        (form.actionParams.monetaryValue === undefined || form.actionParams.monetaryValue === null)) return

    setSaving(true)
    const payload = {
      name: form.name,
      conditionDescription: form.conditionDescription,
      examples: form.examples,
      actionType: form.actionType,
      actionParams: form.actionType === 'update_contact_field' ? null : form.actionParams,
      targetFieldKey: form.targetFieldKey,
      targetValue: form.targetValue,
      overwrite: form.overwrite,
      isActive: form.isActive,
    }

    if (editingId) {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/rules/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const { rule } = await res.json()
      setRules(prev => prev.map(r => r.id === editingId ? rule : r))
    } else {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, order: rules.length }),
      })
      const { rule } = await res.json()
      setRules(prev => [...prev, rule])
    }

    setForm(emptyForm)
    setEditingId(null)
    setShowForm(false)
    setSaving(false)
  }

  async function toggleActive(rule: AgentRule) {
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !rule.isActive }),
    })
    const { rule: updated } = await res.json()
    setRules(prev => prev.map(r => r.id === rule.id ? updated : r))
  }

  async function deleteRule(id: string) {
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/rules/${id}`, { method: 'DELETE' })
    setRules(prev => prev.filter(r => r.id !== id))
  }

  const standardFields = contactFields.filter(f => f.group === 'Standard')
  const customFields = contactFields.filter(f => f.group === 'Custom')

  function fieldName(fieldKey: string) {
    return contactFields.find(f => f.fieldKey === fieldKey)?.name ?? fieldKey
  }

  /** Render a rule's THEN clause as a short summary chip for the list view. */
  function describeThen(rule: AgentRule): string {
    const p = rule.actionParams ?? {}
    switch (rule.actionType) {
      case 'update_contact_field': return `${fieldName(rule.targetFieldKey)} = "${rule.targetValue}"`
      case 'update_contact_tags':  return `+ tag ${((p.tags as string[]) ?? []).map(t => `"${t}"`).join(', ') || '(none)'}`
      case 'remove_contact_tags':  return `− tag ${((p.tags as string[]) ?? []).map(t => `"${t}"`).join(', ') || '(none)'}`
      case 'add_to_workflow':      return `enrol in ${((p.workflowNames as string[]) ?? []).join(', ') || '(none)'}`
      case 'remove_from_workflow': return `remove from ${((p.workflowNames as string[]) ?? []).join(', ') || '(none)'}`
      case 'opportunity_status':   return `opportunity → ${p.status ?? '(not set)'}`
      case 'opportunity_value':    return `opportunity value → ${p.monetaryValue ?? '(not set)'}`
      case 'dnd_channel':          return `DND on ${p.channel || 'current channel'}`
      default:                     return rule.actionType
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  return (
    <div className="p-8 max-w-2xl">
      <p className="text-sm text-zinc-400 mb-1">
        Teach the agent to detect things in conversation and take automatic action.
      </p>
      <p className="text-xs text-zinc-600 mb-6">
        Examples: update a field, add tags, enrol in a workflow, change an opportunity, mark DND.
      </p>

      {/* Existing rules */}
      {rules.length > 0 && (
        <div className="space-y-2 mb-6">
          {rules.map(rule => (
            <div
              key={rule.id}
              className={`rounded-xl border bg-zinc-950 p-4 ${
                rule.isActive ? 'border-zinc-800' : 'border-zinc-900 opacity-50'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-sm font-medium text-zinc-200">{rule.name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-400">
                      → {describeThen(rule)}
                    </span>
                    {rule.actionType === 'update_contact_field' && (
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        rule.overwrite ? 'bg-amber-900/30 text-amber-400' : 'bg-zinc-800 text-zinc-400'
                      }`}>
                        {rule.overwrite ? 'always update' : 'keep first'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 mb-2">Fires when: {rule.conditionDescription}</p>
                  {rule.examples?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {rule.examples.map((ex, i) => (
                        <span key={i} className="text-xs bg-zinc-900 border border-zinc-800 text-zinc-400 rounded px-2 py-0.5">&ldquo;{ex}&rdquo;</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0 mt-1">
                  <button
                    type="button"
                    onClick={() => toggleActive(rule)}
                    className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                      rule.isActive ? 'bg-emerald-500' : 'bg-zinc-700'
                    }`}
                    role="switch"
                    aria-checked={rule.isActive}
                    aria-label={rule.isActive ? 'Disable rule' : 'Enable rule'}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${rule.isActive ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                  <button onClick={() => startEdit(rule)} className="text-xs text-zinc-500 hover:text-white transition-colors">Edit</button>
                  <button onClick={() => deleteRule(rule.id)} className="text-xs text-zinc-600 hover:text-red-400 transition-colors">Remove</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!showForm && (
        <button
          type="button"
          onClick={() => { setShowForm(true); setForm(emptyForm); setEditingId(null) }}
          className="w-full border border-dashed border-zinc-700 hover:border-zinc-500 rounded-xl py-4 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          + Add Rule
        </button>
      )}

      {showForm && (
        <div id="rule-form" className={`rounded-xl border bg-zinc-950 overflow-hidden ${editingId ? 'border-zinc-600' : 'border-zinc-700'}`}>
          <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
            <p className="text-sm font-medium text-zinc-200">{editingId ? 'Edit Rule' : 'Add Rule'}</p>
            <button type="button" onClick={cancelEdit} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
          </div>
          <form onSubmit={handleSubmit} className="p-5 space-y-5">
            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Rule Name</label>
              <input type="text" value={form.name}
                onChange={e => updateForm('name', e.target.value)}
                placeholder="e.g. Interested in service X"
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>

            {/* Condition */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">When the contact&hellip;</label>
              <textarea value={form.conditionDescription}
                onChange={e => updateForm('conditionDescription', e.target.value)}
                placeholder="e.g. asks about Service X pricing, or says they want to book Service X"
                required rows={2}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
              />
              <p className="text-xs text-zinc-600 mt-1">Plain English. The agent matches semantically — paraphrases, typos, and synonyms all count.</p>
            </div>

            {/* Examples */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Example phrases</label>
              <p className="text-xs text-zinc-600 mb-2">Real phrases from your audience. 2–5 good ones is ideal.</p>
              <div className="flex flex-wrap gap-1.5 mb-2 min-h-[24px]">
                {form.examples.map((ex, i) => (
                  <span key={i} className="flex items-center gap-1 bg-zinc-800 text-zinc-300 text-xs rounded-full px-2.5 py-1">
                    &ldquo;{ex}&rdquo;
                    <button type="button" onClick={() => removeExample(i)} className="text-zinc-500 hover:text-red-400 ml-0.5 leading-none">×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input type="text" value={form.newExample}
                  onChange={e => updateForm('newExample', e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExample() } }}
                  placeholder="a real phrase someone might say"
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
                <button type="button" onClick={addExample} className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors">Add</button>
              </div>
            </div>

            {/* THEN — action picker + dynamic param panel */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Then…</label>
                <select
                  value={form.actionType}
                  onChange={e => {
                    // Reset params when the action type changes — stale
                    // params from another action type would just confuse
                    // the save payload.
                    updateForm('actionType', e.target.value as ActionType)
                    updateForm('actionParams', {})
                    updateForm('targetFieldKey', '')
                    updateForm('targetValue', '')
                  }}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                >
                  {(Object.keys(ACTION_LABELS) as ActionType[]).map(a => (
                    <option key={a} value={a}>{ACTION_LABELS[a].label}</option>
                  ))}
                </select>
                <p className="text-[11px] text-zinc-600 mt-1">{ACTION_LABELS[form.actionType].hint}</p>
              </div>

              {/* update_contact_field */}
              {form.actionType === 'update_contact_field' && (
                <>
                  <select value={form.targetFieldKey}
                    onChange={e => updateForm('targetFieldKey', e.target.value)}
                    required
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                  >
                    <option value="">Select a field…</option>
                    {standardFields.length > 0 && (
                      <optgroup label="Standard Fields">
                        {standardFields.map(f => <option key={f.id} value={f.fieldKey}>{f.name}</option>)}
                      </optgroup>
                    )}
                    {customFields.length > 0 && (
                      <optgroup label="Custom Fields">
                        {customFields.map(f => <option key={f.id} value={f.fieldKey}>{f.name}</option>)}
                      </optgroup>
                    )}
                  </select>
                  <div>
                    <label className="block text-xs text-zinc-500 mb-1.5">Set it to this value</label>
                    <input type="text" value={form.targetValue}
                      onChange={e => updateForm('targetValue', e.target.value)}
                      placeholder="e.g. Yes, true, Away until next week"
                      required
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                  <button type="button"
                    onClick={() => updateForm('overwrite', !form.overwrite)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm transition-colors text-left ${
                      form.overwrite ? 'border-amber-700 bg-amber-900/20 text-amber-300' : 'border-zinc-700 text-zinc-400'
                    }`}
                  >
                    <span className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center ${
                      form.overwrite ? 'border-amber-500 bg-amber-500' : 'border-zinc-600'
                    }`}>
                      {form.overwrite && <span className="text-white text-[10px] leading-none">✓</span>}
                    </span>
                    <span>
                      {form.overwrite
                        ? 'Overwrite — always update with the latest mention'
                        : 'Keep first — only set if the field is currently empty'}
                    </span>
                  </button>
                </>
              )}

              {/* update_contact_tags / remove_contact_tags — same input shape */}
              {(form.actionType === 'update_contact_tags' || form.actionType === 'remove_contact_tags') && (
                <div>
                  <label className="block text-xs text-zinc-500 mb-1.5">Tags</label>
                  {(form.actionParams.tags as string[] | undefined)?.length ? (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {(form.actionParams.tags as string[]).map(t => (
                        <span key={t} className="flex items-center gap-1 bg-zinc-800 text-zinc-300 text-xs rounded-full pl-2.5 pr-1 py-1">
                          {t}
                          <button type="button" onClick={() => removeTagParam(t)} className="w-4 h-4 flex items-center justify-center rounded-full text-zinc-500 hover:text-red-400 hover:bg-zinc-700 transition-colors">×</button>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <input type="text" value={form.newTag}
                      onChange={e => updateForm('newTag', e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTagParam() } }}
                      placeholder="tag name, then Enter"
                      className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                    />
                    <button type="button" onClick={addTagParam} className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors">Add</button>
                  </div>
                </div>
              )}

              {/* add_to_workflow / remove_from_workflow — same picker */}
              {(form.actionType === 'add_to_workflow' || form.actionType === 'remove_from_workflow') && (
                <div>
                  <label className="block text-xs text-zinc-500 mb-1.5">Workflows</label>
                  {workflowsError ? (
                    <p className="text-xs text-red-400">{workflowsError}</p>
                  ) : workflows.length === 0 ? (
                    <p className="text-xs text-zinc-500">No published workflows in GHL yet. Publish one, then refresh this page.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {workflows.map(wf => {
                        const on = (form.actionParams.workflowIds as string[] | undefined)?.includes(wf.id)
                        return (
                          <button key={wf.id} type="button"
                            onClick={() => toggleWorkflow(wf)}
                            className={`text-xs rounded-full px-2.5 py-1 border transition-colors ${
                              on ? 'border-blue-600 bg-blue-900/30 text-blue-200'
                                 : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500'
                            }`}
                          >{wf.name}</button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* opportunity_status */}
              {form.actionType === 'opportunity_status' && (
                <div>
                  <label className="block text-xs text-zinc-500 mb-1.5">Mark opportunity as</label>
                  <select
                    value={(form.actionParams.status as string) ?? ''}
                    onChange={e => updateActionParams({ status: e.target.value })}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                  >
                    <option value="">Select status</option>
                    {OPPORTUNITY_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                  <p className="text-[11px] text-zinc-600 mt-1">Applies to the contact&apos;s open opportunity. Multiple opps → all updated.</p>
                </div>
              )}

              {/* opportunity_value */}
              {form.actionType === 'opportunity_value' && (
                <div>
                  <label className="block text-xs text-zinc-500 mb-1.5">Opportunity value</label>
                  <input type="number" inputMode="decimal"
                    value={form.actionParams.monetaryValue ?? ''}
                    onChange={e => updateActionParams({ monetaryValue: e.target.value === '' ? null : parseFloat(e.target.value) })}
                    placeholder="e.g. 5000"
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                </div>
              )}

              {/* dnd_channel */}
              {form.actionType === 'dnd_channel' && (
                <div>
                  <label className="block text-xs text-zinc-500 mb-1.5">Block on channel</label>
                  <select
                    value={(form.actionParams.channel as string) ?? ''}
                    onChange={e => updateActionParams({ channel: e.target.value || null })}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
                  >
                    {DND_CHANNELS.map(c => <option key={c.value || 'current'} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              )}
            </div>

            <button type="submit" disabled={saving}
              className="w-full inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {saving ? (editingId ? 'Saving…' : 'Adding…') : (editingId ? 'Save Changes' : 'Add Rule')}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
