'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useDirtyForm } from '@/lib/use-dirty-form'
import SaveBar from '@/components/dashboard/SaveBar'

interface PersonaData {
  agentPersonaName: string
  responseLength: string
  formalityLevel: string
  useEmojis: boolean
  neverSayList: string[]
  simulateTypos: boolean
  typingDelayEnabled: boolean
  typingDelayMinMs: number
  typingDelayMaxMs: number
  languages: string[]
}

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'pt', label: 'Portuguese' },
]

export default function PersonaPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [loading, setLoading] = useState(true)
  const [initial, setInitial] = useState<PersonaData | null>(null)
  const [neverSayInput, setNeverSayInput] = useState('')

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      .then(r => r.json())
      .then(({ agent }) => {
        setInitial({
          agentPersonaName: agent.agentPersonaName ?? '',
          responseLength: agent.responseLength ?? 'MODERATE',
          formalityLevel: agent.formalityLevel ?? 'NEUTRAL',
          useEmojis: agent.useEmojis ?? false,
          simulateTypos: agent.simulateTypos ?? false,
          typingDelayEnabled: agent.typingDelayEnabled ?? false,
          typingDelayMinMs: agent.typingDelayMinMs ?? 500,
          typingDelayMaxMs: agent.typingDelayMaxMs ?? 3000,
          neverSayList: agent.neverSayList ?? [],
          languages: agent.languages ?? ['en'],
        })
      })
      .finally(() => setLoading(false))
  }, [workspaceId, agentId])

  const { draft, set, dirty, saving, savedAt, error, save, reset } = useDirtyForm<PersonaData>({
    initial,
    onSave: async (d) => {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentPersonaName: d.agentPersonaName || null,
          responseLength: d.responseLength,
          formalityLevel: d.formalityLevel,
          useEmojis: d.useEmojis,
          simulateTypos: d.simulateTypos,
          typingDelayEnabled: d.typingDelayEnabled,
          typingDelayMinMs: d.typingDelayMinMs,
          typingDelayMaxMs: d.typingDelayMaxMs,
          neverSayList: d.neverSayList,
          languages: d.languages,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
    },
  })

  function addNeverSay(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && neverSayInput.trim()) {
      e.preventDefault()
      if (!draft.neverSayList.includes(neverSayInput.trim())) {
        set({ neverSayList: [...draft.neverSayList, neverSayInput.trim()] })
      }
      setNeverSayInput('')
    }
  }

  function toggleLanguage(code: string) {
    set({
      languages: draft.languages.includes(code)
        ? draft.languages.filter(l => l !== code)
        : [...draft.languages, code],
    })
  }

  if (loading || !initial) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  return (
    <div className="p-8">
      <div className="max-w-2xl pb-24">
        <div className="space-y-8">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Agent Persona Name</label>
            <input
              type="text"
              value={draft.agentPersonaName}
              onChange={e => set({ agentPersonaName: e.target.value })}
              placeholder="e.g. Alex"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
            <p className="text-xs text-zinc-600 mt-1">Leave blank to use no specific name.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-3">Response Length</label>
            <div className="space-y-2">
              {[
                { value: 'BRIEF', label: 'Brief', desc: '1 sentence max — very direct' },
                { value: 'MODERATE', label: 'Moderate', desc: '1–3 sentences — balanced' },
                { value: 'DETAILED', label: 'Detailed', desc: 'Full context when needed' },
              ].map(opt => (
                <label key={opt.value} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="responseLength"
                    value={opt.value}
                    checked={draft.responseLength === opt.value}
                    onChange={() => set({ responseLength: opt.value })}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium text-zinc-200">{opt.label}</p>
                    <p className="text-xs text-zinc-500">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-3">Formality Level</label>
            <div className="space-y-2">
              {[
                { value: 'CASUAL', label: 'Casual', desc: 'Friendly, conversational, contractions OK' },
                { value: 'NEUTRAL', label: 'Neutral', desc: 'Professional but approachable' },
                { value: 'FORMAL', label: 'Formal', desc: 'Strict professional tone' },
              ].map(opt => (
                <label key={opt.value} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="formalityLevel"
                    value={opt.value}
                    checked={draft.formalityLevel === opt.value}
                    onChange={() => set({ formalityLevel: opt.value })}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium text-zinc-200">{opt.label}</p>
                    <p className="text-xs text-zinc-500">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm font-medium text-zinc-200">Use Emojis</p>
                <p className="text-xs text-zinc-500">Allow occasional emojis in replies</p>
              </div>
              <button
                type="button"
                onClick={() => set({ useEmojis: !draft.useEmojis })}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${draft.useEmojis ? 'bg-emerald-500' : 'bg-zinc-700'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${draft.useEmojis ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm font-medium text-zinc-200">Simulate Typos</p>
                <p className="text-xs text-zinc-500">Adds subtle human-like typos to messages</p>
              </div>
              <button
                type="button"
                onClick={() => set({ simulateTypos: !draft.simulateTypos })}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${draft.simulateTypos ? 'bg-emerald-500' : 'bg-zinc-700'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${draft.simulateTypos ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </label>

            <div>
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-sm font-medium text-zinc-200">Typing Delay</p>
                  <p className="text-xs text-zinc-500">Simulate human typing time before sending</p>
                </div>
                <button
                  type="button"
                  onClick={() => set({ typingDelayEnabled: !draft.typingDelayEnabled })}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${draft.typingDelayEnabled ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${draft.typingDelayEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </label>
              {draft.typingDelayEnabled && (
                <div className="mt-4 space-y-3 pl-1">
                  <div>
                    <div className="flex justify-between text-xs text-zinc-400 mb-1">
                      <span>Min delay</span>
                      <span>{draft.typingDelayMinMs}ms</span>
                    </div>
                    <input
                      type="range" min={0} max={8000} step={100}
                      value={draft.typingDelayMinMs}
                      onChange={e => set({ typingDelayMinMs: Number(e.target.value) })}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-zinc-400 mb-1">
                      <span>Max delay</span>
                      <span>{draft.typingDelayMaxMs}ms</span>
                    </div>
                    <input
                      type="range" min={0} max={8000} step={100}
                      value={draft.typingDelayMaxMs}
                      onChange={e => set({ typingDelayMaxMs: Number(e.target.value) })}
                      className="w-full"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Never Say List</label>
            <input
              type="text"
              value={neverSayInput}
              onChange={e => setNeverSayInput(e.target.value)}
              onKeyDown={addNeverSay}
              placeholder="Type a word or phrase and press Enter"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
            {draft.neverSayList.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {draft.neverSayList.map(word => (
                  <span key={word} className="inline-flex items-center gap-1 bg-zinc-800 text-zinc-300 text-xs rounded-full px-3 py-1">
                    {word}
                    <button type="button" onClick={() => set({ neverSayList: draft.neverSayList.filter(w => w !== word) })} className="text-zinc-500 hover:text-red-400">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-3">Languages</label>
            <div className="space-y-2">
              {LANGUAGES.map(lang => (
                <label key={lang.code} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.languages.includes(lang.code)}
                    onChange={() => toggleLanguage(lang.code)}
                  />
                  <span className="text-sm text-zinc-200">{lang.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <SaveBar dirty={dirty} saving={saving} savedAt={savedAt} error={error} onSave={save} onReset={reset} />
      </div>
    </div>
  )
}

