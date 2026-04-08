'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

export default function AgentSettingsPage() {
  const params = useParams()
  const locationId = params.locationId as string
  const agentId = params.agentId as string

  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [instructions, setInstructions] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  useEffect(() => {
    fetch(`/api/locations/${locationId}/agents/${agentId}`)
      .then(r => r.json())
      .then(({ agent }) => {
        setName(agent.name)
        setSystemPrompt(agent.systemPrompt)
        setInstructions(agent.instructions ?? '')
      })
      .finally(() => setLoading(false))
  }, [locationId, agentId])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaveMsg('')
    await fetch(`/api/locations/${locationId}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, systemPrompt, instructions }),
    })
    setSaving(false)
    setSaveMsg('Saved')
    setTimeout(() => setSaveMsg(''), 2000)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  return (
    <div className="p-8 max-w-2xl">
      <form onSubmit={save} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">Agent Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">System Prompt</label>
          <p className="text-xs text-zinc-600 mb-2">Defines the agent's role, tone, and context. This is the base of every conversation.</p>
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            required
            rows={10}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500 resize-y font-mono"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">
            Extra Instructions <span className="text-zinc-600 font-normal">(optional)</span>
          </label>
          <p className="text-xs text-zinc-600 mb-2">Appended to every conversation. Useful for campaign-specific rules or temporary overrides.</p>
          <textarea
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            rows={3}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500 resize-y"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 px-5 hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saveMsg && <span className="text-emerald-400 text-sm">{saveMsg}</span>}
        </div>
      </form>
    </div>
  )
}
