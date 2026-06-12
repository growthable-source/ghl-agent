'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useDirtyForm } from '@/lib/use-dirty-form'
import SaveBar from '@/components/dashboard/SaveBar'

interface VocabRow {
  never: string
  sayInstead: string
}

interface PersonaData {
  agentPersonaName: string
  responseLength: string
  formalityLevel: string
  useEmojis: boolean
  vocabularyRules: VocabRow[]
  simulateTypos: boolean
  typingDelayEnabled: boolean
  typingDelayMinMs: number
  typingDelayMaxMs: number
  languages: string[]
  enableQuietCheckIn: boolean
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

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      .then(r => r.json())
      .then(({ agent }) => {
        // Vocabulary rows = saved rules + any legacy never-say terms
        // that haven't been upgraded to a rule yet (shown with an empty
        // replacement). Saving writes both fields, so once the operator
        // touches this page the data converges.
        const rules: VocabRow[] = Array.isArray(agent.vocabularyRules)
          ? agent.vocabularyRules
              .filter((r: any) => r && typeof r.never === 'string' && r.never.trim())
              .map((r: any) => ({ never: r.never, sayInstead: typeof r.sayInstead === 'string' ? r.sayInstead : '' }))
          : []
        const known = new Set(rules.map(r => r.never.toLowerCase()))
        for (const term of (agent.neverSayList ?? []) as string[]) {
          if (typeof term === 'string' && term.trim() && !known.has(term.trim().toLowerCase())) {
            rules.push({ never: term.trim(), sayInstead: '' })
          }
        }
        setInitial({
          agentPersonaName: agent.agentPersonaName ?? '',
          responseLength: agent.responseLength ?? 'MODERATE',
          formalityLevel: agent.formalityLevel ?? 'NEUTRAL',
          useEmojis: agent.useEmojis ?? false,
          simulateTypos: agent.simulateTypos ?? false,
          typingDelayEnabled: agent.typingDelayEnabled ?? false,
          typingDelayMinMs: agent.typingDelayMinMs ?? 500,
          typingDelayMaxMs: agent.typingDelayMaxMs ?? 3000,
          vocabularyRules: rules,
          languages: agent.languages ?? ['en'],
          enableQuietCheckIn: agent.enableQuietCheckIn ?? true,
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
          // vocabularyRules is the source of truth; the legacy
          // neverSayList keeps carrying the replacement-less terms so
          // the persona prompt line on older code paths still works.
          vocabularyRules: d.vocabularyRules
            .filter(r => r.never.trim())
            .map(r => ({ never: r.never.trim(), sayInstead: r.sayInstead.trim() || null })),
          neverSayList: d.vocabularyRules
            .filter(r => r.never.trim() && !r.sayInstead.trim())
            .map(r => r.never.trim()),
          languages: d.languages,
          enableQuietCheckIn: d.enableQuietCheckIn,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
    },
  })

  function setRule(idx: number, patch: Partial<VocabRow>) {
    set({ vocabularyRules: draft.vocabularyRules.map((r, i) => i === idx ? { ...r, ...patch } : r) })
  }
  function removeRule(idx: number) {
    set({ vocabularyRules: draft.vocabularyRules.filter((_, i) => i !== idx) })
  }
  function addRule(row: VocabRow = { never: '', sayInstead: '' }) {
    if (row.never && draft.vocabularyRules.some(r => r.never.toLowerCase() === row.never.toLowerCase())) return
    set({ vocabularyRules: [...draft.vocabularyRules, row] })
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
      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p>
    </div>
  )

  return (
    <div className="p-8">
      <div className="max-w-2xl pb-24">
        <div className="space-y-8">
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Agent Persona Name</label>
            <input
              type="text"
              value={draft.agentPersonaName}
              onChange={e => set({ agentPersonaName: e.target.value })}
              placeholder="e.g. Alex"
              className="w-full rounded-lg px-4 py-2.5 text-sm focus:outline-none"
              style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            />
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Leave blank to use no specific name.</p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>Response Length</label>
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
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{opt.label}</p>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>Formality Level</label>
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
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{opt.label}</p>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Use Emojis</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Allow occasional emojis in replies</p>
              </div>
              <button
                type="button"
                onClick={() => set({ useEmojis: !draft.useEmojis })}
                className="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors"
                style={{ background: draft.useEmojis ? 'var(--accent-emerald)' : 'var(--toggle-off-bg)' }}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full shadow transition ${draft.useEmojis ? 'translate-x-4' : 'translate-x-0'}`}
                  style={{ background: '#fff' }}
                />
              </button>
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Simulate Typos</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Adds subtle human-like typos to messages</p>
              </div>
              <button
                type="button"
                onClick={() => set({ simulateTypos: !draft.simulateTypos })}
                className="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors"
                style={{ background: draft.simulateTypos ? 'var(--accent-emerald)' : 'var(--toggle-off-bg)' }}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full shadow transition ${draft.simulateTypos ? 'translate-x-4' : 'translate-x-0'}`}
                  style={{ background: '#fff' }}
                />
              </button>
            </label>

            <label className="flex items-center justify-between cursor-pointer">
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Auto check-in when visitor goes quiet</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>After ~3 minutes of silence on a live chat, send one brief in-voice nudge so the visitor doesn&apos;t abandon the conversation.</p>
              </div>
              <button
                type="button"
                onClick={() => set({ enableQuietCheckIn: !draft.enableQuietCheckIn })}
                className="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors"
                style={{ background: draft.enableQuietCheckIn ? 'var(--accent-emerald)' : 'var(--toggle-off-bg)' }}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full shadow transition ${draft.enableQuietCheckIn ? 'translate-x-4' : 'translate-x-0'}`}
                  style={{ background: '#fff' }}
                />
              </button>
            </label>

            <div>
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Typing Delay</p>
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Simulate human typing time before sending</p>
                </div>
                <button
                  type="button"
                  onClick={() => set({ typingDelayEnabled: !draft.typingDelayEnabled })}
                  className="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors"
                  style={{ background: draft.typingDelayEnabled ? 'var(--accent-emerald)' : 'var(--toggle-off-bg)' }}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full shadow transition ${draft.typingDelayEnabled ? 'translate-x-4' : 'translate-x-0'}`}
                    style={{ background: '#fff' }}
                  />
                </button>
              </label>
              {draft.typingDelayEnabled && (
                <div className="mt-4 space-y-3 pl-1">
                  <div>
                    <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
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
                    <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-tertiary)' }}>
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
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Vocabulary — never say / say instead</label>
            <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
              Terms the agent must never use — even when its knowledge sources use them word-for-word.
              Add a replacement and it&apos;s <span className="font-semibold">enforced on every reply</span>, not just suggested:
              if the term slips through, it&apos;s swapped automatically before the customer sees it.
              Leave &ldquo;say instead&rdquo; empty to simply forbid a phrase.
            </p>
            <div className="space-y-2">
              {draft.vocabularyRules.map((rule, idx) => (
                <div key={idx}>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={rule.never}
                      onChange={e => setRule(idx, { never: e.target.value })}
                      placeholder="Never say…"
                      className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
                      style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
                    />
                    <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>→</span>
                    <input
                      type="text"
                      value={rule.sayInstead}
                      onChange={e => setRule(idx, { sayInstead: e.target.value })}
                      placeholder="Say instead (optional)"
                      className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
                      style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
                    />
                    <button
                      type="button"
                      onClick={() => removeRule(idx)}
                      title="Remove rule"
                      className="w-8 h-8 shrink-0 rounded-lg hover:text-red-400 transition-colors"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      ×
                    </button>
                  </div>
                  {/* Live example so the operator sees exactly what the
                      agent is told — same wording as the prompt block. */}
                  {rule.never.trim() && rule.sayInstead.trim() && (
                    <p className="text-[11px] mt-1 ml-1" style={{ color: 'var(--text-muted)' }}>
                      ❌ &ldquo;You can do this in {rule.never.trim()}.&rdquo; → ✅ &ldquo;You can do this in {rule.sayInstead.trim()}.&rdquo;
                    </p>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <button
                type="button"
                onClick={() => addRule()}
                className="text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors hover:bg-zinc-900"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                + Add rule
              </button>
              {/* One-click for the most common whitelabel ask. */}
              {!draft.vocabularyRules.some(r => r.never.toLowerCase() === 'highlevel') && (
                <button
                  type="button"
                  onClick={() => { addRule({ never: 'HighLevel', sayInstead: 'your CRM' }); addRule({ never: 'GHL', sayInstead: 'your CRM' }) }}
                  className="text-xs px-3 py-1.5 rounded-lg border border-dashed transition-colors hover:bg-zinc-900"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                >
                  + Whitelabel preset (HighLevel/GHL → your CRM)
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-3" style={{ color: 'var(--text-secondary)' }}>Languages</label>
            <div className="space-y-2">
              {LANGUAGES.map(lang => (
                <label key={lang.code} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.languages.includes(lang.code)}
                    onChange={() => toggleLanguage(lang.code)}
                  />
                  <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{lang.label}</span>
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

