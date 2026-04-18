'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useDirtyForm } from '@/lib/use-dirty-form'
import SaveBar from '@/components/dashboard/SaveBar'

type FallbackBehavior = 'message' | 'transfer' | 'message_and_transfer'

interface Settings {
  name: string
  systemPrompt: string
  instructions: string
  fallbackBehavior: FallbackBehavior
  fallbackMessage: string
}

export default function AgentSettingsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [loading, setLoading] = useState(true)
  const [initial, setInitial] = useState<Settings | null>(null)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      .then(r => r.json())
      .then(({ agent }) => {
        setInitial({
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          instructions: agent.instructions ?? '',
          fallbackBehavior: agent.fallbackBehavior ?? 'message',
          fallbackMessage: agent.fallbackMessage ?? '',
        })
      })
      .finally(() => setLoading(false))
  }, [workspaceId, agentId])

  const { draft, set, dirty, saving, savedAt, error, save, reset } = useDirtyForm<Settings>({
    initial,
    onSave: async (d) => {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: d.name,
          systemPrompt: d.systemPrompt,
          instructions: d.instructions,
          fallbackBehavior: d.fallbackBehavior,
          fallbackMessage: d.fallbackMessage || null,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
    },
  })

  if (loading || !initial) return (
    <div className="flex items-center justify-center h-48">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  return (
    <div className="p-8 max-w-2xl pb-24">
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-2">Agent Name</label>
          <input
            type="text"
            value={draft.name}
            onChange={e => set({ name: e.target.value })}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">System Prompt</label>
          <p className="text-xs text-zinc-600 mb-2">Defines the agent&apos;s role, tone, and context. This is the base of every conversation.</p>
          <textarea
            value={draft.systemPrompt}
            onChange={e => set({ systemPrompt: e.target.value })}
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
            value={draft.instructions}
            onChange={e => set({ instructions: e.target.value })}
            rows={3}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500 resize-y"
          />
        </div>

        {/* Fallback behavior */}
        <div className="border-t border-zinc-800 pt-6">
          <label className="block text-sm font-medium text-zinc-300 mb-1">When the agent doesn&apos;t know the answer</label>
          <p className="text-xs text-zinc-600 mb-3">What should the agent do when a contact asks something it has no knowledge about?</p>
          <div className="space-y-2 mb-4">
            {([
              { value: 'message' as const, label: 'Send a fallback message', desc: 'Reply with a custom message and stay in the conversation' },
              { value: 'transfer' as const, label: 'Transfer to a human', desc: 'Immediately hand off to a human agent' },
              { value: 'message_and_transfer' as const, label: 'Message then transfer', desc: 'Send a message and then hand off to a human' },
            ] as const).map(opt => (
              <button key={opt.value} type="button" onClick={() => set({ fallbackBehavior: opt.value })}
                className={`w-full flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                  draft.fallbackBehavior === opt.value
                    ? 'border-white bg-zinc-900'
                    : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
                }`}>
                <span className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                  draft.fallbackBehavior === opt.value ? 'border-white' : 'border-zinc-600'
                }`}>
                  {draft.fallbackBehavior === opt.value && <span className="w-2 h-2 rounded-full bg-white" />}
                </span>
                <div>
                  <p className="text-sm text-zinc-200">{opt.label}</p>
                  <p className="text-xs text-zinc-500">{opt.desc}</p>
                </div>
              </button>
            ))}
          </div>
          {(draft.fallbackBehavior === 'message' || draft.fallbackBehavior === 'message_and_transfer') && (
            <div>
              <label className="block text-xs text-zinc-500 mb-1.5">Fallback message</label>
              <input
                type="text"
                value={draft.fallbackMessage}
                onChange={e => set({ fallbackMessage: e.target.value })}
                placeholder="That's a great question — let me find out and get back to you."
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>
          )}
        </div>
      </div>

      <SaveBar dirty={dirty} saving={saving} savedAt={savedAt} error={error} onSave={save} onReset={reset} />
    </div>
  )
}
