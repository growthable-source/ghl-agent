'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface AgentRule {
  id: string
  name: string
  conditionDescription: string
  examples: string[]
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

const emptyForm = {
  name: '',
  conditionDescription: '',
  examples: [] as string[],
  targetFieldKey: '',
  targetValue: '',
  overwrite: false,
  isActive: true,
  newExample: '',
}

export default function RulesPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [rules, setRules] = useState<AgentRule[]>([])
  const [contactFields, setContactFields] = useState<ContactField[]>([])
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
    ]).finally(() => setLoading(false))
  }, [workspaceId, agentId])

  function updateForm<K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function addExample() {
    const ex = form.newExample.trim()
    if (!ex) return
    setForm(prev => ({ ...prev, examples: [...prev.examples, ex], newExample: '' }))
  }

  function removeExample(i: number) {
    setForm(prev => ({ ...prev, examples: prev.examples.filter((_, idx) => idx !== i) }))
  }

  function startEdit(r: AgentRule) {
    setEditingId(r.id)
    setForm({
      name: r.name,
      conditionDescription: r.conditionDescription,
      examples: r.examples ?? [],
      targetFieldKey: r.targetFieldKey,
      targetValue: r.targetValue,
      overwrite: r.overwrite,
      isActive: r.isActive,
      newExample: '',
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
    if (!form.name.trim() || !form.conditionDescription.trim() || !form.targetFieldKey || !form.targetValue.trim()) return
    setSaving(true)

    const payload = {
      name: form.name,
      conditionDescription: form.conditionDescription,
      examples: form.examples,
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

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  return (
    <div className="p-8 max-w-2xl">
      <p className="text-sm text-zinc-400 mb-1">
        Teach the agent to detect things in conversation and update contact fields automatically.
      </p>
      <p className="text-xs text-zinc-600 mb-6">
        Example: when the contact says <span className="text-zinc-400">&ldquo;I&apos;m out of town&rdquo;</span> or <span className="text-zinc-400">&ldquo;I&apos;m away&rdquo;</span>, set the <span className="font-mono text-zinc-400">Out of Town</span> field to <span className="font-mono text-zinc-400">Yes</span>.
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
                      → {fieldName(rule.targetFieldKey)} = &ldquo;{rule.targetValue}&rdquo;
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      rule.overwrite ? 'bg-amber-900/30 text-amber-400' : 'bg-zinc-800 text-zinc-400'
                    }`}>
                      {rule.overwrite ? 'always update' : 'keep first'}
                    </span>
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
                  <button
                    onClick={() => startEdit(rule)}
                    className="text-xs text-zinc-500 hover:text-white transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteRule(rule.id)}
                    className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit form */}
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
            <button type="button" onClick={cancelEdit} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
              Cancel
            </button>
          </div>
          <form onSubmit={handleSubmit} className="p-5 space-y-5">
            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Rule Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => updateForm('name', e.target.value)}
                placeholder="e.g. Out of Town"
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
              <p className="text-xs text-zinc-600 mt-1">Short label so you can find this rule later.</p>
            </div>

            {/* Condition */}
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">When the contact&hellip;</label>
              <textarea
                value={form.conditionDescription}
                onChange={e => updateForm('conditionDescription', e.target.value)}
                placeholder="e.g. indicates they are out of town, traveling, away, or otherwise unreachable"
                required
                rows={2}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
              />
              <p className="text-xs text-zinc-600 mt-1">Describe the condition in plain English. The agent matches semantically — it&apos;ll catch paraphrases, typos, and synonyms.</p>
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
                <input
                  type="text"
                  value={form.newExample}
                  onChange={e => updateForm('newExample', e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addExample() } }}
                  placeholder="e.g. im out of town, im away sorry, back next week"
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
                <button type="button" onClick={addExample} className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors">
                  Add
                </button>
              </div>
            </div>

            {/* Then */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
              <p className="text-xs font-medium text-zinc-300">Then update this contact field</p>
              <select
                value={form.targetFieldKey}
                onChange={e => updateForm('targetFieldKey', e.target.value)}
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
              >
                <option value="">Select a field…</option>
                {standardFields.length > 0 && (
                  <optgroup label="Standard Fields">
                    {standardFields.map(f => (
                      <option key={f.id} value={f.fieldKey}>{f.name}</option>
                    ))}
                  </optgroup>
                )}
                {customFields.length > 0 && (
                  <optgroup label="Custom Fields">
                    {customFields.map(f => (
                      <option key={f.id} value={f.fieldKey}>{f.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>

              <div>
                <label className="block text-xs text-zinc-500 mb-1.5">Set it to this value</label>
                <input
                  type="text"
                  value={form.targetValue}
                  onChange={e => updateForm('targetValue', e.target.value)}
                  placeholder="e.g. Yes, true, Away until next week"
                  required
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
              </div>

              <button
                type="button"
                onClick={() => updateForm('overwrite', !form.overwrite)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm transition-colors text-left ${
                  form.overwrite
                    ? 'border-amber-700 bg-amber-900/20 text-amber-300'
                    : 'border-zinc-700 text-zinc-400'
                }`}
              >
                <span className={`w-4 h-4 rounded border-2 flex-shrink-0 flex items-center justify-center ${
                  form.overwrite ? 'border-amber-500 bg-amber-500' : 'border-zinc-600'
                }`}>
                  {form.overwrite && <span className="text-white text-[10px] leading-none">✓</span>}
                </span>
                <span>
                  {form.overwrite
                    ? 'Overwrite — always update the field with the latest mention'
                    : 'Keep first — only set the field if it&apos;s currently empty'}
                </span>
              </button>
            </div>

            <button
              type="submit"
              disabled={saving}
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
