'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface PersonaData {
  agentPersonaName: string | null
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
  const locationId = params.locationId as string
  const agentId = params.agentId as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  const [personaName, setPersonaName] = useState('')
  const [responseLength, setResponseLength] = useState('MODERATE')
  const [formalityLevel, setFormalityLevel] = useState('NEUTRAL')
  const [useEmojis, setUseEmojis] = useState(false)
  const [simulateTypos, setSimulateTypos] = useState(false)
  const [typingDelayEnabled, setTypingDelayEnabled] = useState(false)
  const [typingDelayMinMs, setTypingDelayMinMs] = useState(500)
  const [typingDelayMaxMs, setTypingDelayMaxMs] = useState(3000)
  const [neverSayList, setNeverSayList] = useState<string[]>([])
  const [neverSayInput, setNeverSayInput] = useState('')
  const [languages, setLanguages] = useState<string[]>(['en'])

  useEffect(() => {
    fetch(`/api/locations/${locationId}/agents/${agentId}`)
      .then(r => r.json())
      .then(({ agent }) => {
        setPersonaName(agent.agentPersonaName ?? '')
        setResponseLength(agent.responseLength ?? 'MODERATE')
        setFormalityLevel(agent.formalityLevel ?? 'NEUTRAL')
        setUseEmojis(agent.useEmojis ?? false)
        setSimulateTypos(agent.simulateTypos ?? false)
        setTypingDelayEnabled(agent.typingDelayEnabled ?? false)
        setTypingDelayMinMs(agent.typingDelayMinMs ?? 500)
        setTypingDelayMaxMs(agent.typingDelayMaxMs ?? 3000)
        setNeverSayList(agent.neverSayList ?? [])
        setLanguages(agent.languages ?? ['en'])
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
      body: JSON.stringify({
        agentPersonaName: personaName || null,
        responseLength,
        formalityLevel,
        useEmojis,
        simulateTypos,
        typingDelayEnabled,
        typingDelayMinMs,
        typingDelayMaxMs,
        neverSayList,
        languages,
      }),
    })
    setSaving(false)
    setSaveMsg('Saved')
    setTimeout(() => setSaveMsg(''), 2000)
  }

  function addNeverSay(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && neverSayInput.trim()) {
      e.preventDefault()
      if (!neverSayList.includes(neverSayInput.trim())) {
        setNeverSayList([...neverSayList, neverSayInput.trim()])
      }
      setNeverSayInput('')
    }
  }

  function toggleLanguage(code: string) {
    if (languages.includes(code)) {
      setLanguages(languages.filter(l => l !== code))
    } else {
      setLanguages([...languages, code])
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold mb-2">Persona & Tone</h1>
        <p className="text-zinc-400 text-sm mb-8">Configure how the agent presents itself and communicates.</p>

        <form onSubmit={save} className="space-y-8">
          {/* Agent Name */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Agent Persona Name</label>
            <input
              type="text"
              value={personaName}
              onChange={e => setPersonaName(e.target.value)}
              placeholder="e.g. Alex"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
            <p className="text-xs text-zinc-600 mt-1">Leave blank to use no specific name.</p>
          </div>

          {/* Response Length */}
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
                    checked={responseLength === opt.value}
                    onChange={() => setResponseLength(opt.value)}
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

          {/* Formality */}
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
                    checked={formalityLevel === opt.value}
                    onChange={() => setFormalityLevel(opt.value)}
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

          {/* Toggles */}
          <div className="space-y-4">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm font-medium text-zinc-200">Use Emojis</p>
                <p className="text-xs text-zinc-500">Allow occasional emojis in replies</p>
              </div>
              <button
                type="button"
                onClick={() => setUseEmojis(!useEmojis)}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${useEmojis ? 'bg-emerald-500' : 'bg-zinc-700'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${useEmojis ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm font-medium text-zinc-200">Simulate Typos</p>
                <p className="text-xs text-zinc-500">Adds subtle human-like typos to messages</p>
              </div>
              <button
                type="button"
                onClick={() => setSimulateTypos(!simulateTypos)}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${simulateTypos ? 'bg-emerald-500' : 'bg-zinc-700'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${simulateTypos ? 'translate-x-4' : 'translate-x-0'}`} />
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
                  onClick={() => setTypingDelayEnabled(!typingDelayEnabled)}
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${typingDelayEnabled ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${typingDelayEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </label>
              {typingDelayEnabled && (
                <div className="mt-4 space-y-3 pl-1">
                  <div>
                    <div className="flex justify-between text-xs text-zinc-400 mb-1">
                      <span>Min delay</span>
                      <span>{typingDelayMinMs}ms</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={8000}
                      step={100}
                      value={typingDelayMinMs}
                      onChange={e => setTypingDelayMinMs(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs text-zinc-400 mb-1">
                      <span>Max delay</span>
                      <span>{typingDelayMaxMs}ms</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={8000}
                      step={100}
                      value={typingDelayMaxMs}
                      onChange={e => setTypingDelayMaxMs(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Never Say List */}
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
            {neverSayList.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {neverSayList.map(word => (
                  <span key={word} className="inline-flex items-center gap-1 bg-zinc-800 text-zinc-300 text-xs rounded-full px-3 py-1">
                    {word}
                    <button type="button" onClick={() => setNeverSayList(neverSayList.filter(w => w !== word))} className="text-zinc-500 hover:text-red-400">
                      x
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Languages */}
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-3">Languages</label>
            <div className="space-y-2">
              {LANGUAGES.map(lang => (
                <label key={lang.code} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={languages.includes(lang.code)}
                    onChange={() => toggleLanguage(lang.code)}
                  />
                  <span className="text-sm text-zinc-200">{lang.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 px-5 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Persona'}
            </button>
            {saveMsg && <span className="text-emerald-400 text-sm">{saveMsg}</span>}
          </div>
        </form>
      </div>
    </div>
  )
}
