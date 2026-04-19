'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface ListeningRule {
  id: string
  name: string
  description: string
  examples: string[]
  isActive: boolean
  order: number
}

const emptyForm = {
  name: '',
  description: '',
  examples: [] as string[],
  isActive: true,
  newExample: '',
}

export default function ListeningPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [rules, setRules] = useState<ListeningRule[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/listening-rules`)
      .then(r => r.json())
      .then(({ rules }) => setRules(rules ?? []))
      .finally(() => setLoading(false))
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

  function startEdit(r: ListeningRule) {
    setEditingId(r.id)
    setForm({
      name: r.name,
      description: r.description,
      examples: r.examples ?? [],
      isActive: r.isActive,
      newExample: '',
    })
    setShowForm(true)
    setTimeout(() => document.getElementById('listening-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyForm)
    setShowForm(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.description.trim()) return
    setSaving(true)

    const payload = {
      name: form.name,
      description: form.description,
      examples: form.examples,
      isActive: form.isActive,
    }

    if (editingId) {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/listening-rules/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const { rule } = await res.json()
      setRules(prev => prev.map(r => r.id === editingId ? rule : r))
    } else {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/listening-rules`, {
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

  async function toggleActive(rule: ListeningRule) {
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/listening-rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !rule.isActive }),
    })
    const { rule: updated } = await res.json()
    setRules(prev => prev.map(r => r.id === rule.id ? updated : r))
  }

  async function deleteRule(id: string) {
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/listening-rules/${id}`, { method: 'DELETE' })
    setRules(prev => prev.filter(r => r.id !== id))
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  return (
    <div className="p-8 max-w-2xl">
      <p className="text-sm text-zinc-400 mb-1">
        Categories of context the agent listens for passively — without asking.
      </p>
      <p className="text-xs text-zinc-600 mb-6">
        Example: when someone mentions <span className="text-zinc-400">&ldquo;my mum is sick&rdquo;</span> or <span className="text-zinc-400">&ldquo;I just got engaged&rdquo;</span>, it goes into the agent&apos;s private notes about this contact. The info isn&apos;t pushed to GoHighLevel — it&apos;s remembered across future conversations so the agent can reference it naturally.
      </p>

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
                    <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">memory category</span>
                  </div>
                  <p className="text-xs text-zinc-500 mb-2">Listen for: {rule.description}</p>
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
          + Add Listening Category
        </button>
      )}

      {showForm && (
        <div id="listening-form" className={`rounded-xl border bg-zinc-950 overflow-hidden ${editingId ? 'border-zinc-600' : 'border-zinc-700'}`}>
          <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
            <p className="text-sm font-medium text-zinc-200">{editingId ? 'Edit Category' : 'Add Category'}</p>
            <button type="button" onClick={cancelEdit} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">Cancel</button>
          </div>
          <form onSubmit={handleSubmit} className="p-5 space-y-5">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Category Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => updateForm('name', e.target.value)}
                placeholder="e.g. Family context"
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
              <p className="text-xs text-zinc-600 mt-1">The agent stores captured info under this label in its memory of each contact.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">What should the agent listen for?</label>
              <textarea
                value={form.description}
                onChange={e => updateForm('description', e.target.value)}
                placeholder="e.g. family members, health issues, life events, anything personal that helps the agent show empathy or remember context"
                required
                rows={3}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
              />
              <p className="text-xs text-zinc-600 mt-1">Describe the kind of context this category covers. Keep it broad — the agent will match semantically.</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">Example phrases</label>
              <p className="text-xs text-zinc-600 mb-2">Real phrases from your audience. 2–5 is usually enough.</p>
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
                  placeholder="e.g. my mum is sick, just got engaged, dealing with a lot at home"
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                />
                <button type="button" onClick={addExample} className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors">Add</button>
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {saving ? (editingId ? 'Saving…' : 'Adding…') : (editingId ? 'Save Changes' : 'Add Category')}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
