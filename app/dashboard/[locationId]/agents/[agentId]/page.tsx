'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type FallbackBehavior = 'message' | 'transfer' | 'message_and_transfer'

export default function AgentSettingsPage() {
  const params = useParams()
  const locationId = params.locationId as string
  const agentId = params.agentId as string

  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [instructions, setInstructions] = useState('')
  const [fallbackBehavior, setFallbackBehavior] = useState<FallbackBehavior>('message')
  const [fallbackMessage, setFallbackMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  useEffect(() => {
    fetch(`/api/locations/${locationId}/agents/${agentId}`)
      .then(r => r.json())
      .then(({ agent }) => {
        setName(agent.name)
        setSystemPrompt(agent.systemPrompt)
        setInstructions(agent.instructions ?? '')
        setFallbackBehavior(agent.fallbackBehavior ?? 'message')
        setFallbackMessage(agent.fallbackMessage ?? '')
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
      body: JSON.stringify({ name, systemPrompt, instructions, fallbackBehavior, fallbackMessage: fallbackMessage || null }),
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

        {/* Fallback / Unknown Answer Behavior */}
        <div className="border-t border-zinc-800 pt-6">
          <label className="block text-sm font-medium text-zinc-300 mb-1">When the agent doesn't know the answer</label>
          <p className="text-xs text-zinc-600 mb-3">What should the agent do when a contact asks something it has no knowledge about?</p>
          <div className="space-y-2 mb-4">
            {([
              { value: 'message' as const, label: 'Send a fallback message', desc: 'Reply with a custom message and stay in the conversation' },
              { value: 'transfer' as const, label: 'Transfer to a human', desc: 'Immediately hand off to a human agent' },
              { value: 'message_and_transfer' as const, label: 'Message then transfer', desc: 'Send a message and then hand off to a human' },
            ] as const).map(opt => (
              <button key={opt.value} type="button" onClick={() => setFallbackBehavior(opt.value)}
                className={`w-full flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                  fallbackBehavior === opt.value
                    ? 'border-white bg-zinc-900'
                    : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
                }`}>
                <span className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                  fallbackBehavior === opt.value ? 'border-white' : 'border-zinc-600'
                }`}>
                  {fallbackBehavior === opt.value && <span className="w-2 h-2 rounded-full bg-white" />}
                </span>
                <div>
                  <p className="text-sm text-zinc-200">{opt.label}</p>
                  <p className="text-xs text-zinc-500">{opt.desc}</p>
                </div>
              </button>
            ))}
          </div>
          {(fallbackBehavior === 'message' || fallbackBehavior === 'message_and_transfer') && (
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5">Fallback message</label>
              <input
                type="text"
                value={fallbackMessage}
                onChange={e => setFallbackMessage(e.target.value)}
                placeholder="That's a great question — let me find out and get back to you."
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>
          )}
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
