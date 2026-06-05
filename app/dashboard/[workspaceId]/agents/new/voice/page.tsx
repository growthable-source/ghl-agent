'use client'

/**
 * Voice Agent Wizard — opinionated, voice-only.
 *
 * Mirrors the state pattern of the text wizard at ../page.tsx (STEPS
 * array, currentIdx, visibleSteps, draft-state-per-step) but is
 * structured around voice concerns. Submits to the same
 * POST /api/workspaces/:wsId/agents endpoint with agentType: 'VOICE'
 * and a vapiConfig body field that the server uses to create the
 * VapiConfig row in the same request.
 */

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { VOICE_TEMPLATES, type VoiceTemplate } from '@/lib/voice/templates'
import { generateAgentName } from '@/lib/random-name'
import VoicePhoneCallUI from '@/components/dashboard/VoicePhoneCallUI'

type Step = 'use_case' | 'voice' | 'personality' | 'knowledge' | 'phone' | 'try_it'

const STEPS: { key: Step; label: string }[] = [
  { key: 'use_case',    label: 'Use case' },
  { key: 'voice',       label: 'Voice' },
  { key: 'personality', label: 'Personality' },
  { key: 'knowledge',   label: 'Knowledge' },
  { key: 'phone',       label: 'Phone' },
  { key: 'try_it',      label: 'Try it' },
]

// Vapi is always the phone provider (owns the number, owns the bridge).
// What the user actually picks is the TTS engine that runs inside the
// Vapi assistant config — ElevenLabs v3 (5000+ voices) or xAI Grok (5
// voices, native Vapi partner integration). Both route through Vapi
// for phone calls; the difference is the voice itself.
type Engine = 'elevenlabs' | 'xai'

interface VoiceOption {
  id: string
  name: string
  language?: string
  labels?: { gender?: string; accent?: string; age?: string; description?: string }
  previewUrl?: string
}

interface PhoneNumberOption {
  id: string
  number: string
  name?: string
}

interface KnowledgeDomain {
  id: string
  name: string
}

export default function VoiceWizardPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  const [step, setStep] = useState<Step>('use_case')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ─── Step 1: use case ─────────────────────────────────────────────
  const [template, setTemplate] = useState<VoiceTemplate | null>(null)

  // ─── Voice engine — tab choice on the Voice step. Default to
  //     ElevenLabs (the 5000+ voice catalogue is the natural starting
  //     point). Persisted to VapiConfig.ttsProvider on submit so the
  //     server-side Vapi voice-block builder picks the right engine.
  const [engine, setEngine] = useState<Engine>('elevenlabs')

  // ─── Step 3: voice ────────────────────────────────────────────────
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [voicesLoading, setVoicesLoading] = useState(false)
  const [voiceQuery, setVoiceQuery] = useState('')
  const [accentFilter, setAccentFilter] = useState<string>('any')
  const [selectedVoice, setSelectedVoice] = useState<VoiceOption | null>(null)
  const [previewPlaying, setPreviewPlaying] = useState<string | null>(null)

  // ─── Step 4: personality ──────────────────────────────────────────
  const [agentName, setAgentName] = useState(() => generateAgentName())
  const [firstMessage, setFirstMessage] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [endCallMessage, setEndCallMessage] = useState('')
  const [formalityLevel, setFormalityLevel] = useState(50)

  // Auto-populate personality fields when a template is picked, only
  // while the user hasn't typed their own copy yet.
  const [personalityTouched, setPersonalityTouched] = useState(false)
  useEffect(() => {
    if (!template || personalityTouched) return
    setFirstMessage(template.firstMessage)
    setSystemPrompt(template.systemPrompt)
    setEndCallMessage(template.endCallMessage)
    setFormalityLevel(template.formalityLevel)
  }, [template, personalityTouched])

  // ─── Step 5: knowledge ────────────────────────────────────────────
  const [knowledgeDomains, setKnowledgeDomains] = useState<KnowledgeDomain[]>([])
  const [knowledgeMode, setKnowledgeMode] = useState<'all' | 'pick' | 'none'>('all')
  const [knowledgePick, setKnowledgePick] = useState<string[]>([])

  // ─── Step 6: phone ────────────────────────────────────────────────
  const [phoneMode, setPhoneMode] = useState<'buy' | 'skip' | 'port'>('buy')
  const [areaCode, setAreaCode] = useState('')
  const [purchasedNumber, setPurchasedNumber] = useState<PhoneNumberOption | null>(null)
  const [purchasing, setPurchasing] = useState(false)
  const [purchaseError, setPurchaseError] = useState<string | null>(null)

  // ─── Step 7: try_it — handled by VoicePhoneCallUI after submit ────
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null)

  // Every wizard step is always visible (Vapi supports phone, so the
  // phone step never auto-hides). Kept as a computed list for parity
  // with the text wizard's pattern; future conditional steps go here.
  const visibleSteps = useMemo(() => STEPS, [])
  const currentIdx = visibleSteps.findIndex(s => s.key === step)

  // Voices fetcher. The /api/voices endpoint returns the legacy
  // ElevenLabs snake_case shape ({ voice_id, preview_url, … }); we
  // normalise to the camelCase VoiceOption the wizard works with so
  // selection (selected?.id === v.id) and preview (voice.previewUrl)
  // both work without per-call massaging in every render path. Without
  // this map every voice had id=undefined → every card looked selected
  // and the play button did nothing.
  const fetchVoices = useCallback(async (eng: Engine) => {
    setVoicesLoading(true)
    try {
      // /api/voices accepts the legacy provider names: 'vapi' for the
      // ElevenLabs catalogue (Vapi proxies it) and 'xai' for the Grok
      // voices. Map the engine onto whichever name the endpoint
      // currently understands.
      const queryProvider = eng === 'xai' ? 'xai' : 'vapi'
      const res = await fetch(`/api/voices?provider=${queryProvider}`)
      const data = await res.json()
      const raw = Array.isArray(data.voices) ? data.voices : []
      setVoices(raw.map((v: any) => ({
        id: v.voice_id ?? v.id,
        name: v.name,
        previewUrl: v.preview_url ?? v.previewUrl ?? undefined,
        labels: v.labels ?? {},
        language: v.language ?? undefined,
      })))
    } catch (err: any) {
      console.error('[voice-wizard] voices fetch failed:', err)
      setVoices([])
    } finally {
      setVoicesLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchVoices(engine)
    // Reset selection when engine changes — voice ids aren't portable
    // between ElevenLabs and Grok.
    setSelectedVoice(null)
  }, [engine, fetchVoices])

  // Knowledge domains fetcher
  useEffect(() => {
    fetch(`/api/admin/knowledge-domains?workspaceId=${workspaceId}`)
      .then(r => r.ok ? r.json() : { domains: [] })
      .then(d => setKnowledgeDomains(Array.isArray(d.domains) ? d.domains : []))
      .catch(() => setKnowledgeDomains([]))
  }, [workspaceId])

  // Accent options derived from loaded voices (so the filter chips
  // actually reflect what's available, not a hardcoded list).
  const accentOptions = useMemo(() => {
    const set = new Set<string>()
    for (const v of voices) {
      const a = v.labels?.accent
      if (a) set.add(a)
    }
    return Array.from(set).sort()
  }, [voices])

  const filteredVoices = useMemo(() => {
    const q = voiceQuery.trim().toLowerCase()
    return voices.filter(v => {
      if (accentFilter !== 'any' && v.labels?.accent !== accentFilter) return false
      if (!q) return true
      return v.name.toLowerCase().includes(q)
        || (v.labels?.description ?? '').toLowerCase().includes(q)
        || (v.labels?.gender ?? '').toLowerCase().includes(q)
    })
  }, [voices, voiceQuery, accentFilter])

  function playPreview(voice: VoiceOption) {
    if (!voice.previewUrl) return
    if (previewPlaying === voice.id) {
      setPreviewPlaying(null)
      return
    }
    setPreviewPlaying(voice.id)
    const audio = new Audio(voice.previewUrl)
    audio.onended = () => setPreviewPlaying(null)
    audio.onerror = () => setPreviewPlaying(null)
    audio.play().catch(() => setPreviewPlaying(null))
  }

  // ─── Phone purchase ───────────────────────────────────────────────
  async function purchaseNumber() {
    setPurchasing(true)
    setPurchaseError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/vapi/phone-numbers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ areaCode: areaCode.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Purchase failed (${res.status})`)
      setPurchasedNumber(data.phoneNumber || data)
    } catch (err: any) {
      setPurchaseError(err.message ?? 'Failed to purchase number')
    } finally {
      setPurchasing(false)
    }
  }

  // ─── Submit ───────────────────────────────────────────────────────
  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const knowledgeDomainIds =
        knowledgeMode === 'all' ? null
        : knowledgeMode === 'none' ? []
        : knowledgePick
      const body: Record<string, unknown> = {
        name: agentName,
        systemPrompt,
        agentType: 'VOICE',
        formalityLevel,
        ...(knowledgeDomainIds && { knowledgeDomainIds }),
        vapiConfig: {
          isActive: true,
          // Persist 'xai' for the Grok engine; otherwise 'vapi' (the
          // legacy synonym for ElevenLabs that the server's
          // resolveVoiceEngine() helper maps to the 'elevenlabs'
          // engine). Stays back-compat with existing rows.
          ttsProvider: engine === 'xai' ? 'xai' : 'vapi',
          voiceId: selectedVoice?.id ?? '',
          voiceName: selectedVoice?.name ?? null,
          firstMessage,
          endCallMessage,
          phoneNumberId: purchasedNumber?.id ?? null,
          phoneNumber: purchasedNumber?.number ?? null,
          maxDurationSecs: 600,
          recordCalls: true,
        },
      }
      const res = await fetch(`/api/workspaces/${workspaceId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Create failed (${res.status})`)
      setCreatedAgentId(data.agent.id)
      // Wizard stays on the try_it step; VoicePhoneCallUI takes over
      // (it needs an agent that exists to issue browser/test calls).
      setStep('try_it')
    } catch (err: any) {
      setError(err.message ?? 'Failed to create voice agent')
    } finally {
      setSubmitting(false)
    }
  }

  function next() {
    const nextIdx = currentIdx + 1
    if (nextIdx < visibleSteps.length) setStep(visibleSteps[nextIdx].key)
  }
  function back() {
    const prevIdx = currentIdx - 1
    if (prevIdx >= 0) setStep(visibleSteps[prevIdx].key)
  }

  // ─── Per-step Continue-enabled rules ──────────────────────────────
  const canContinue = (() => {
    if (step === 'use_case') return template !== null
    if (step === 'voice') return selectedVoice !== null
    if (step === 'personality') return firstMessage.trim().length > 0 && systemPrompt.trim().length > 0
    if (step === 'knowledge') return true
    if (step === 'phone') return phoneMode === 'skip' || phoneMode === 'port' || !!purchasedNumber
    return false
  })()

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--background)' }}>
      <div className="max-w-3xl mx-auto px-6 py-8 lg:px-10 lg:py-12">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            href={`/dashboard/${workspaceId}/agents`}
            className="text-sm hover:underline"
            style={{ color: 'var(--text-tertiary)' }}
          >
            ← Back to agents
          </Link>
        </div>
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          New voice agent
        </h1>
        <p className="text-sm mb-8" style={{ color: 'var(--text-tertiary)' }}>
          Build a voice agent in six short steps. Powered by ElevenLabs v3
          + Vapi — Vapi handles the phone number and the call routing,
          ElevenLabs supplies the voice. Test it on a real call at the end.
        </p>

        {/* Step pills */}
        <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
          {visibleSteps.map((s, i) => {
            const isActive = s.key === step
            const isDone = i < currentIdx
            return (
              <div key={s.key} className="flex items-center gap-2 flex-shrink-0">
                <span
                  className="text-xs font-medium px-3 py-1.5 rounded-full"
                  style={{
                    background: isActive
                      ? 'rgba(250,77,46,0.15)'
                      : isDone
                        ? 'rgba(34,197,94,0.12)'
                        : 'var(--surface-secondary)',
                    color: isActive ? '#fa4d2e' : isDone ? '#22c55e' : 'var(--text-tertiary)',
                  }}
                >
                  {i + 1}. {s.label}
                </span>
                {i < visibleSteps.length - 1 && (
                  <span style={{ color: 'var(--text-muted)' }}>→</span>
                )}
              </div>
            )
          })}
        </div>

        {/* Step bodies */}
        <div
          className="rounded-2xl p-6 lg:p-8 mb-6"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          {step === 'use_case' && (
            <UseCaseStep template={template} onPick={setTemplate} />
          )}
          {step === 'voice' && (
            <VoiceStep
              voices={filteredVoices}
              loading={voicesLoading}
              query={voiceQuery}
              onQuery={setVoiceQuery}
              accents={accentOptions}
              accent={accentFilter}
              onAccent={setAccentFilter}
              selected={selectedVoice}
              onSelect={setSelectedVoice}
              previewPlaying={previewPlaying}
              onPreview={playPreview}
              engine={engine}
              onEngine={setEngine}
            />
          )}
          {step === 'personality' && (
            <PersonalityStep
              name={agentName}
              onName={(v) => { setAgentName(v); setPersonalityTouched(true) }}
              firstMessage={firstMessage}
              onFirstMessage={(v) => { setFirstMessage(v); setPersonalityTouched(true) }}
              systemPrompt={systemPrompt}
              onSystemPrompt={(v) => { setSystemPrompt(v); setPersonalityTouched(true) }}
              endCallMessage={endCallMessage}
              onEndCallMessage={(v) => { setEndCallMessage(v); setPersonalityTouched(true) }}
              formalityLevel={formalityLevel}
              onFormality={(v) => { setFormalityLevel(v); setPersonalityTouched(true) }}
            />
          )}
          {step === 'knowledge' && (
            <KnowledgeStep
              domains={knowledgeDomains}
              mode={knowledgeMode}
              onMode={setKnowledgeMode}
              pick={knowledgePick}
              onPick={setKnowledgePick}
            />
          )}
          {step === 'phone' && (
            <PhoneStep
              mode={phoneMode}
              onMode={setPhoneMode}
              areaCode={areaCode}
              onAreaCode={setAreaCode}
              purchasedNumber={purchasedNumber}
              purchasing={purchasing}
              error={purchaseError}
              onPurchase={purchaseNumber}
            />
          )}
          {step === 'try_it' && (
            <TryItStep
              workspaceId={workspaceId}
              agentId={createdAgentId}
              submitting={submitting}
              error={error}
              onCreate={submit}
              hasSelection={!!selectedVoice}
              agentName={agentName}
              voiceId={selectedVoice?.id ?? ''}
              firstMessage={firstMessage}
              // Always Vapi for the browser test — both engines route
              // through Vapi at runtime. The legacy ttsProvider prop is
              // kept for shape compatibility until Step 4 removes the
              // xAI realtime branch from VoicePhoneCallUI.
              ttsProvider="vapi"
              outboundEnabled={!!purchasedNumber}
            />
          )}
        </div>

        {/* Step nav */}
        <div className="flex items-center justify-between">
          <button
            onClick={back}
            disabled={currentIdx === 0 || step === 'try_it'}
            className="text-sm px-4 py-2 rounded-lg border disabled:opacity-40"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--text-secondary)',
              background: 'transparent',
            }}
          >
            Back
          </button>

          {step !== 'try_it' && (
            <button
              onClick={() => {
                // On phone step → submit just before transitioning to try_it.
                // On every other step → just advance.
                const isLastBeforeTry = visibleSteps[currentIdx + 1]?.key === 'try_it'
                if (isLastBeforeTry) submit()
                else next()
              }}
              disabled={!canContinue || submitting}
              className="text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-40"
              style={{ background: '#fa4d2e', color: '#ffffff' }}
            >
              {submitting
                ? 'Creating…'
                : visibleSteps[currentIdx + 1]?.key === 'try_it'
                  ? 'Create voice agent →'
                  : 'Continue →'}
            </button>
          )}

          {step === 'try_it' && createdAgentId && (
            <Link
              href={`/dashboard/${workspaceId}/agents/${createdAgentId}`}
              className="text-sm font-semibold px-5 py-2.5 rounded-lg"
              style={{ background: '#fa4d2e', color: '#ffffff' }}
            >
              Open agent →
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Step components ────────────────────────────────────────────────

function UseCaseStep({ template, onPick }: { template: VoiceTemplate | null; onPick: (t: VoiceTemplate) => void }) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        What's this voice agent for?
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
        Pick the closest fit. The template seeds the opening line, prompt, and tone — you'll edit it in the next steps.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {VOICE_TEMPLATES.map(t => {
          const active = template?.id === t.id
          return (
            <button
              key={t.id}
              onClick={() => onPick(t)}
              className="text-left rounded-xl p-5 transition-all"
              style={{
                background: 'var(--surface-secondary)',
                border: active ? '2px solid #fa4d2e' : '1px solid var(--border)',
                boxShadow: active ? '0 4px 20px -4px rgba(250,77,46,0.2)' : 'none',
              }}
            >
              <div className="text-2xl mb-2">{t.icon}</div>
              <div className="font-semibold text-sm mb-1" style={{ color: 'var(--text-primary)' }}>{t.name}</div>
              <div className="text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>{t.tagline}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function VoiceStep({
  voices, loading, query, onQuery, accents, accent, onAccent,
  selected, onSelect, previewPlaying, onPreview, engine, onEngine,
}: {
  voices: VoiceOption[]; loading: boolean
  query: string; onQuery: (v: string) => void
  accents: string[]; accent: string; onAccent: (v: string) => void
  selected: VoiceOption | null; onSelect: (v: VoiceOption) => void
  previewPlaying: string | null; onPreview: (v: VoiceOption) => void
  engine: Engine; onEngine: (e: Engine) => void
}) {
  // Engine tabs sit at the top of the voice step. Both engines route
  // through Vapi at runtime — the tab just controls which voice
  // catalogue the user is browsing AND which provider gets baked into
  // the assistant config (resolveVoiceEngine + buildVapiVoiceBlock
  // server-side).
  return (
    <div>
      <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        Pick a voice
      </h2>
      <p className="text-sm mb-5" style={{ color: 'var(--text-tertiary)' }}>
        Both engines route phone calls through Vapi. Pick whichever voice
        you like — the call works the same.
      </p>
      <div
        className="inline-flex items-center gap-1 p-1 rounded-lg mb-5"
        style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}
      >
        {([
          { id: 'elevenlabs' as const, label: 'ElevenLabs', count: '5000+' },
          { id: 'xai' as const,        label: 'Grok',       count: '5' },
        ]).map(opt => {
          const active = engine === opt.id
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onEngine(opt.id)}
              className="text-xs font-semibold px-3 py-1.5 rounded-md transition-colors"
              style={
                active
                  ? { background: '#fa4d2e', color: '#ffffff' }
                  : { background: 'transparent', color: 'var(--text-secondary)' }
              }
            >
              {opt.label}
              <span className="ml-1.5 opacity-70 font-normal">{opt.count}</span>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="text"
          value={query}
          onChange={e => onQuery(e.target.value)}
          placeholder="Search voices…"
          className="flex-1 min-w-[200px] rounded-lg px-3 py-2 text-sm focus:outline-none"
          style={{
            background: 'var(--input-bg)',
            border: '1px solid var(--input-border)',
            color: 'var(--input-text)',
          }}
        />
        <select
          value={accent}
          onChange={e => onAccent(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm focus:outline-none"
          style={{
            background: 'var(--input-bg)',
            border: '1px solid var(--input-border)',
            color: 'var(--input-text)',
          }}
        >
          <option value="any">Any accent</option>
          {accents.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      {loading ? (
        <p className="text-sm py-6 text-center" style={{ color: 'var(--text-tertiary)' }}>Loading voices…</p>
      ) : voices.length === 0 ? (
        <p className="text-sm py-6 text-center" style={{ color: 'var(--text-tertiary)' }}>No voices match — try clearing the search.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[420px] overflow-y-auto pr-1">
          {voices.slice(0, 80).map(v => {
            const isSelected = selected?.id === v.id
            return (
              <div
                key={v.id}
                onClick={() => onSelect(v)}
                className="rounded-lg p-3 cursor-pointer flex items-center gap-3 transition-all"
                style={{
                  background: 'var(--surface-secondary)',
                  border: isSelected ? '2px solid #fa4d2e' : '1px solid var(--border)',
                }}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); onPreview(v) }}
                  disabled={!v.previewUrl}
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-colors disabled:opacity-40"
                  style={{ background: 'rgba(250,77,46,0.15)', color: '#fa4d2e' }}
                  title={v.previewUrl ? 'Preview' : 'No preview available'}
                >
                  {previewPlaying === v.id ? '⏸' : '▶'}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>{v.name}</div>
                  <div className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>
                    {[v.labels?.gender, v.labels?.accent, v.labels?.age, v.labels?.description].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {selected && (
        <p className="text-xs mt-3" style={{ color: 'var(--accent-emerald, #22c55e)' }}>
          Selected: {selected.name}
        </p>
      )}
    </div>
  )
}

function PersonalityStep({
  name, onName, firstMessage, onFirstMessage, systemPrompt, onSystemPrompt,
  endCallMessage, onEndCallMessage, formalityLevel, onFormality,
}: {
  name: string; onName: (v: string) => void
  firstMessage: string; onFirstMessage: (v: string) => void
  systemPrompt: string; onSystemPrompt: (v: string) => void
  endCallMessage: string; onEndCallMessage: (v: string) => void
  formalityLevel: number; onFormality: (v: number) => void
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        Personality & opening line
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
        How the agent introduces itself and how it should think.
      </p>
      <div className="space-y-5">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Agent name</label>
          <input
            type="text"
            value={name}
            onChange={e => onName(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Opening line (every call starts with this)</label>
          <input
            type="text"
            value={firstMessage}
            onChange={e => onFirstMessage(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>System prompt</label>
          <textarea
            value={systemPrompt}
            onChange={e => onSystemPrompt(e.target.value)}
            rows={10}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none font-mono"
            style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Closing line (graceful hang-up)</label>
          <input
            type="text"
            value={endCallMessage}
            onChange={e => onEndCallMessage(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5 flex items-center justify-between" style={{ color: 'var(--text-secondary)' }}>
            <span>Formality</span>
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              {formalityLevel < 33 ? 'Casual' : formalityLevel < 67 ? 'Conversational' : 'Formal'}
            </span>
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={formalityLevel}
            onChange={e => onFormality(parseInt(e.target.value, 10))}
            className="w-full accent-orange-500"
          />
        </div>
      </div>
    </div>
  )
}

function KnowledgeStep({
  domains, mode, onMode, pick, onPick,
}: {
  domains: KnowledgeDomain[]
  mode: 'all' | 'pick' | 'none'
  onMode: (m: 'all' | 'pick' | 'none') => void
  pick: string[]
  onPick: (p: string[]) => void
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        Knowledge
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
        What can the agent reference during a call? Voice agents speak short answers — feed it short, accurate source material.
      </p>
      <div className="space-y-2 mb-4">
        {[
          ['all', 'All workspace knowledge', 'Use every knowledge collection in this workspace'],
          ['pick', 'Pick specific collections', `Choose from ${domains.length} collection${domains.length === 1 ? '' : 's'}`],
          ['none', 'No knowledge', "Agent answers from the system prompt only"],
        ].map(([m, label, hint]) => {
          const active = mode === m
          return (
            <label
              key={m}
              className="flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors"
              style={{
                background: active ? 'rgba(250,77,46,0.08)' : 'var(--surface-secondary)',
                border: active ? '1px solid #fa4d2e' : '1px solid var(--border)',
              }}
            >
              <input
                type="radio"
                name="kmode"
                checked={active}
                onChange={() => onMode(m as 'all' | 'pick' | 'none')}
                className="mt-1 accent-orange-500"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</div>
                <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{hint}</div>
              </div>
            </label>
          )
        })}
      </div>
      {mode === 'pick' && (
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {domains.length === 0 ? (
            <p className="text-xs italic" style={{ color: 'var(--text-tertiary)' }}>
              No knowledge collections yet. Create one from the Knowledge page first, then come back.
            </p>
          ) : domains.map(d => {
            const checked = pick.includes(d.id)
            return (
              <label key={d.id} className="flex items-center gap-2 px-3 py-1.5 rounded cursor-pointer text-sm" style={{ color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    onPick(checked ? pick.filter(x => x !== d.id) : [...pick, d.id])
                  }}
                  className="accent-orange-500"
                />
                {d.name}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PhoneStep({
  mode, onMode, areaCode, onAreaCode, purchasedNumber, purchasing, error, onPurchase,
}: {
  mode: 'buy' | 'skip' | 'port'
  onMode: (m: 'buy' | 'skip' | 'port') => void
  areaCode: string
  onAreaCode: (v: string) => void
  purchasedNumber: PhoneNumberOption | null
  purchasing: boolean
  error: string | null
  onPurchase: () => void
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        Phone number
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
        Where calls come in and go out from. You can skip this and add one later — browser testing still works without a number.
      </p>
      <div className="space-y-3">
        {/* Buy */}
        <div
          onClick={() => onMode('buy')}
          className="rounded-xl p-4 cursor-pointer transition-all"
          style={{
            background: mode === 'buy' ? 'rgba(250,77,46,0.08)' : 'var(--surface-secondary)',
            border: mode === 'buy' ? '2px solid #fa4d2e' : '1px solid var(--border)',
          }}
        >
          <div className="flex items-start gap-3">
            <input type="radio" name="pmode" checked={mode === 'buy'} onChange={() => onMode('buy')} className="mt-1 accent-orange-500" />
            <div className="flex-1">
              <div className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>Buy a new number</div>
              <div className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>Provision a fresh number through Vapi (US area-code).</div>
              {mode === 'buy' && (
                <div>
                  {purchasedNumber ? (
                    <div className="text-sm font-medium" style={{ color: '#22c55e' }}>
                      ✓ {purchasedNumber.number} — ready
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={areaCode}
                        onChange={e => onAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
                        placeholder="e.g. 415"
                        className="w-28 rounded-lg px-3 py-2 text-sm focus:outline-none"
                        style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
                      />
                      <button
                        type="button"
                        onClick={onPurchase}
                        disabled={!areaCode || purchasing}
                        className="text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-40"
                        style={{ background: '#fa4d2e', color: '#ffffff' }}
                      >
                        {purchasing ? 'Buying…' : 'Get number'}
                      </button>
                    </div>
                  )}
                  {error && <p className="text-xs mt-2" style={{ color: '#ef4444' }}>{error}</p>}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Skip */}
        <div
          onClick={() => onMode('skip')}
          className="rounded-xl p-4 cursor-pointer transition-all"
          style={{
            background: mode === 'skip' ? 'rgba(250,77,46,0.08)' : 'var(--surface-secondary)',
            border: mode === 'skip' ? '2px solid #fa4d2e' : '1px solid var(--border)',
          }}
        >
          <div className="flex items-start gap-3">
            <input type="radio" name="pmode" checked={mode === 'skip'} onChange={() => onMode('skip')} className="mt-1 accent-orange-500" />
            <div>
              <div className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>Skip for now</div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Browser test calls work without a number. Add one later from the Voice tab.</div>
            </div>
          </div>
        </div>

        {/* Port */}
        <div
          onClick={() => onMode('port')}
          className="rounded-xl p-4 cursor-pointer transition-all"
          style={{
            background: mode === 'port' ? 'rgba(250,77,46,0.08)' : 'var(--surface-secondary)',
            border: mode === 'port' ? '2px solid #fa4d2e' : '1px solid var(--border)',
          }}
        >
          <div className="flex items-start gap-3">
            <input type="radio" name="pmode" checked={mode === 'port'} onChange={() => onMode('port')} className="mt-1 accent-orange-500" />
            <div>
              <div className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>I already have a number</div>
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Twilio / Vonage / 8x8 numbers can be ported in. Email support@voxility.ai and we'll connect it for you.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TryItStep({
  workspaceId, agentId, submitting, error, onCreate, hasSelection,
  agentName, voiceId, firstMessage, ttsProvider, outboundEnabled,
}: {
  workspaceId: string
  agentId: string | null
  submitting: boolean
  error: string | null
  onCreate: () => void
  hasSelection: boolean
  agentName: string
  voiceId: string
  firstMessage: string
  ttsProvider: 'vapi' | 'xai'
  outboundEnabled: boolean
}) {
  // Resolve the workspace's primary location id — needed for the
  // outbound-call API. Fetched lazily once we have an agent.
  const [locationId, setLocationId] = useState<string | null>(null)
  useEffect(() => {
    if (!agentId) return
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: any) => d?.agent?.locationId && setLocationId(d.agent.locationId))
      .catch(() => {})
  }, [workspaceId, agentId])

  return (
    <div>
      <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        Try it on a real call
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
        We'll create the agent and bring up a phone simulator. Test in your browser or dial out to a real number.
      </p>
      {!agentId ? (
        <div>
          {error && (
            <div className="rounded-lg p-3 mb-4 text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
              {error}
            </div>
          )}
          <button
            onClick={onCreate}
            disabled={submitting || !hasSelection}
            className="text-sm font-semibold px-5 py-2.5 rounded-lg disabled:opacity-40"
            style={{ background: '#fa4d2e', color: '#ffffff' }}
          >
            {submitting ? 'Creating agent…' : 'Create agent and test'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <VoicePhoneCallUI
            workspaceId={workspaceId}
            agentId={agentId}
            agentName={agentName}
            voiceId={voiceId}
            firstMessage={firstMessage}
            ttsProvider={ttsProvider}
            locationId={locationId ?? ''}
            outboundEnabled={outboundEnabled && !!locationId}
          />
          <p className="text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Your voice agent is live. <Link href={`/dashboard/${workspaceId}/agents/${agentId}`} className="underline" style={{ color: '#fa4d2e' }}>Open the agent</Link> to keep configuring.
          </p>
        </div>
      )}
    </div>
  )
}
