'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'

export default function NewAgentPage() {
  const router = useRouter()
  const params = useParams()
  const locationId = params.locationId as string

  const [name, setName] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [instructions, setInstructions] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !systemPrompt.trim()) return
    setSaving(true)
    setError('')

    try {
      const res = await fetch(`/api/locations/${locationId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, systemPrompt, instructions }),
      })
      if (!res.ok) throw new Error('Failed to create agent')
      const { agent } = await res.json()
      router.push(`/dashboard/${locationId}/agents/${agent.id}`)
    } catch {
      setError('Something went wrong. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold mb-8">Create Agent</h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Agent Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sales Assistant"
              required
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">System Prompt</label>
            <p className="text-xs text-zinc-500 mb-2">The core identity and role of the agent.</p>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a helpful sales assistant for Acme Corp. You respond to inbound SMS leads..."
              required
              rows={6}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-y"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Additional Instructions <span className="text-zinc-600">(optional)</span></label>
            <p className="text-xs text-zinc-500 mb-2">Extra rules, tone guidelines, or step-by-step behaviour.</p>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="- Always greet the contact by first name&#10;- If they ask about pricing, send them to the booking link&#10;- Never mention competitors"
              rows={4}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-y"
            />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 px-5 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create Agent'}
            </button>
            <Link href={`/dashboard/${locationId}`} className="text-sm text-zinc-500 hover:text-white transition-colors">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
