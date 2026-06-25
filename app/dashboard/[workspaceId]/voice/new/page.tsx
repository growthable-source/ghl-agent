'use client'

/**
 * Voice Agent Wizard — opinionated, voice-only.
 *
 * Canonical home is /voice/new (the voice section's "+ New voice
 * agent" CTA lands here). The old /agents/new/voice URL redirects
 * here for bookmark safety.
 *
 * Mirrors the state pattern of the text wizard at
 * /agents/new/page.tsx (STEPS array, currentIdx, visibleSteps,
 * draft-state-per-step). Submits to
 * POST /api/workspaces/:wsId/agents with agentType: 'VOICE' + a
 * vapiConfig body the server uses to create the VapiConfig row in
 * the same request.
 *
 * Default voice stack mirrors Vapi's demo "Riley" assistant exactly:
 * Vapi-native voice (Elliot) + OpenAI gpt-4.1 + Deepgram nova-3.
 * The model + transcriber defaults are applied server-side in
 * lib/voice/vapi-assistant.ts — this wizard just picks the voice.
 */

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { VOICE_TEMPLATES, type VoiceTemplate } from '@/lib/voice/templates'
import { generateAgentName } from '@/lib/random-name'
import VoicePhoneCallUI from '@/components/dashboard/VoicePhoneCallUI'
import { GeminiPhoneNumberPanel } from '@/components/voice/GeminiPhoneNumberPanel'
import { VAPI_NATIVE_DEFAULT_VOICE_ID } from '@/lib/voice/vapi-native-voices'

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
// The user picks the TTS engine that runs inside the Vapi assistant
// config — Vapi-native voices (Elliot et al., Riley's stack) or any
// of ElevenLabs' 5000+ voices. Both engines route through Vapi for
// phone calls.
type Engine = 'cartesia' | 'vapi' | 'elevenlabs' | 'gemini'

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
  const workspaceId = params.workspaceId as string

  const [step, setStep] = useState<Step>('use_case')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ─── Step 1: use case ─────────────────────────────────────────────
  const [template, setTemplate] = useState<VoiceTemplate | null>(null)

  // ─── Voice engine — tab choice on the Voice step. Default to
  //     Cartesia (Sonic) — the most-human voice, Vapi's own default
  //     provider, and it keeps our Claude brain + tools on every call.
  //     Standard / ElevenLabs remain as alternatives.
  const [engine, setEngine] = useState<Engine>('cartesia')

  // ─── Step 2: voice ────────────────────────────────────────────────
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [voicesLoading, setVoicesLoading] = useState(false)
  const [voiceQuery, setVoiceQuery] = useState('')
  const [accentFilter, setAccentFilter] = useState<string>('any')
  const [selectedVoice, setSelectedVoice] = useState<VoiceOption | null>(null)
  const [previewPlaying, setPreviewPlaying] = useState<string | null>(null)

  // ─── Step 3: personality ──────────────────────────────────────────
  const [agentName, setAgentName] = useState(() => generateAgentName())
  const [firstMessage, setFirstMessage] = useState('')
  // Raw system prompt — only edited directly in the power-user "raw mode"
  // escape hatch. The default flow composes the prompt from the two
  // plain-language fields below so non-technical operators never face a
  // blank LLM-instruction textarea.
  const [systemPrompt, setSystemPrompt] = useState('')
  const [job, setJob] = useState('')              // "What should this agent do on calls?"
  const [guardrails, setGuardrails] = useState('') // "Anything it must always / never do?"
  const [rawMode, setRawMode] = useState(false)
  const [endCallMessage, setEndCallMessage] = useState('')
  const [formalityLevel, setFormalityLevel] = useState(50)

  const [personalityTouched, setPersonalityTouched] = useState(false)
  useEffect(() => {
    if (!template || personalityTouched) return
    setFirstMessage(template.firstMessage)
    // Templates ship a ready-made, plain-language prompt. Seed both the raw
    // field (for raw mode) and the "job" field (for the default flow) so the
    // user starts from working copy either way.
    setSystemPrompt(template.systemPrompt)
    setJob(template.systemPrompt)
    setEndCallMessage(template.endCallMessage)
    setFormalityLevel(template.formalityLevel)
  }, [template, personalityTouched])

  // The system prompt we actually submit. Default flow composes job +
  // guardrails into instructions; raw mode submits the verbatim textarea.
  const composedSystemPrompt = rawMode
    ? systemPrompt
    : [job.trim(), guardrails.trim() ? `Always keep these rules in mind:\n${guardrails.trim()}` : '']
        .filter(Boolean)
        .join('\n\n')

  // ─── Step 4: knowledge ────────────────────────────────────────────
  const [knowledgeDomains, setKnowledgeDomains] = useState<KnowledgeDomain[]>([])
  const [knowledgeMode, setKnowledgeMode] = useState<'all' | 'pick' | 'none'>('all')
  const [knowledgePick, setKnowledgePick] = useState<string[]>([])

  // ─── Step 5: phone ────────────────────────────────────────────────
  const [phoneMode, setPhoneMode] = useState<'buy' | 'skip' | 'port'>('buy')
  const [areaCode, setAreaCode] = useState('')
  // Vapi sells provider-managed numbers in a few countries. US is the
  // only one on the free tier; AU / GB / CA / NZ require billing on
  // dashboard.vapi.ai. The picker is a no-op for free-tier operators (the
  // API rejects non-US gracefully) — we still surface the option here
  // so customers ready for international calls don't have to drop into
  // Vapi's dashboard to provision.
  const [countryCode, setCountryCode] = useState('US')
  const [purchasedNumber, setPurchasedNumber] = useState<PhoneNumberOption | null>(null)
  const [purchasing, setPurchasing] = useState(false)
  const [purchaseError, setPurchaseError] = useState<string | null>(null)

  // ─── Step 6: try_it — handled by VoicePhoneCallUI after submit ────
  const [createdAgentId, setCreatedAgentId] = useState<string | null>(null)

  const visibleSteps = useMemo(() => STEPS, [])
  const currentIdx = visibleSteps.findIndex(s => s.key === step)

  // /api/voices accepts ?provider=vapi (Vapi-native catalogue) or
  // ?provider=elevenlabs (5000+ catalogue). Engine ids map 1:1.
  const fetchVoices = useCallback(async (eng: Engine) => {
    setVoicesLoading(true)
    try {
      const res = await fetch(`/api/voices?provider=${eng}`)
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
    // between Vapi-native and ElevenLabs catalogues.
    setSelectedVoice(null)
  }, [engine, fetchVoices])

  // Pre-select Elliot when the Vapi tab loads its catalogue. Skipping
  // the manual selection click on the most common happy path — operators
  // who want to deviate just click another card.
  useEffect(() => {
    if (engine !== 'vapi' || selectedVoice || voices.length === 0) return
    const elliot = voices.find(v => v.id.toLowerCase() === VAPI_NATIVE_DEFAULT_VOICE_ID)
    if (elliot) setSelectedVoice(elliot)
  }, [engine, voices, selectedVoice])

  // Cartesia is the wizard default (most-human), so pre-select its first
  // voice (Katie) once the catalogue loads. Keeps canContinue (which
  // requires a selectedVoice) green on the happy path.
  useEffect(() => {
    if (engine !== 'cartesia' || selectedVoice || voices.length === 0) return
    setSelectedVoice(voices[0])
  }, [engine, voices, selectedVoice])

  // Knowledge domains fetcher
  useEffect(() => {
    fetch(`/api/admin/knowledge-domains?workspaceId=${workspaceId}`)
      .then(r => r.ok ? r.json() : { domains: [] })
      .then(d => setKnowledgeDomains(Array.isArray(d.domains) ? d.domains : []))
      .catch(() => setKnowledgeDomains([]))
  }, [workspaceId])

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
    // Vapi-native and ElevenLabs ship pre-recorded preview URLs. Gemini
    // native voices have none (no public one-shot CDN clip), so fall back
    // to on-demand synth via /api/voices/preview — otherwise the play
    // button is dead for the most-human engine.
    const url = voice.previewUrl
      ?? (engine === 'gemini' ? `/api/voices/preview?voice=${encodeURIComponent(voice.id)}` : null)
    if (!url) return
    if (previewPlaying === voice.id) {
      setPreviewPlaying(null)
      return
    }
    setPreviewPlaying(voice.id)
    const audio = new Audio(url)
    audio.onended = () => setPreviewPlaying(null)
    audio.onerror = () => setPreviewPlaying(null)
    audio.play().catch(() => setPreviewPlaying(null))
  }

  async function purchaseNumber() {
    setPurchasing(true)
    setPurchaseError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/vapi/phone-numbers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countryCode, areaCode: areaCode.trim() }),
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

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      const knowledgeDomainIds =
        knowledgeMode === 'all' ? null
        : knowledgeMode === 'none' ? []
        : knowledgePick
      // Gemini is a native speech-to-speech runtime — it persists to
      // GeminiVoiceConfig and never touches Vapi. The Twilio number is
      // bought on the final step after the agent exists, so no number
      // travels in this body. Vapi/ElevenLabs keep the existing vapiConfig.
      const voiceBody = engine === 'gemini'
        ? {
            geminiVoiceConfig: {
              isActive: true,
              voiceName: selectedVoice?.id ?? null,
              firstMessage,
              endCallMessage,
              language: null,
            },
          }
        : {
            vapiConfig: {
              isActive: true,
              // Post-Phase-D the two recognised values on VapiConfig.ttsProvider
              // are 'vapi' (Vapi-native) and 'elevenlabs'. resolveVoiceEngine
              // server-side maps unknown/legacy values to 'vapi' as the new
              // default.
              ttsProvider: engine,
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
      const body: Record<string, unknown> = {
        name: agentName,
        systemPrompt: composedSystemPrompt,
        agentType: 'VOICE',
        formalityLevel,
        ...(knowledgeDomainIds && { knowledgeDomainIds }),
        ...voiceBody,
      }
      const res = await fetch(`/api/workspaces/${workspaceId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Create failed (${res.status})`)
      setCreatedAgentId(data.agent.id)
      if (data.vapiSyncError?.message) {
        setError(`Agent created, but Vapi rejected the voice config: ${data.vapiSyncError.message}. Open the agent's Voice tab to adjust and re-save.`)
      }
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

  const canContinue = (() => {
    if (step === 'use_case') return template !== null
    if (step === 'voice') return selectedVoice !== null
    if (step === 'personality') return firstMessage.trim().length > 0 && composedSystemPrompt.trim().length > 0
    if (step === 'knowledge') return true
    if (step === 'phone') {
      // Gemini buys its Twilio number on the final step (after the agent
      // exists), so the phone step is informational — always passable.
      if (engine === 'gemini') return true
      return phoneMode === 'skip' || phoneMode === 'port' || !!purchasedNumber
    }
    return false
  })()

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: 'var(--background)' }}>
      <div className="max-w-3xl mx-auto px-6 py-8 lg:px-10 lg:py-12">
        <div className="flex items-center gap-3 mb-6">
          <Link
            href={`/dashboard/${workspaceId}/voice`}
            className="text-sm hover:underline"
            style={{ color: 'var(--text-tertiary)' }}
          >
            ← Back to voice agents
          </Link>
        </div>
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          New voice agent
        </h1>
        <p className="text-sm mb-8" style={{ color: 'var(--text-tertiary)' }}>
          Build a voice agent in six short steps. Pick a use case, a voice, a phone
          number, and you&apos;re live. The default stack ships a built-in voice
          with industry-grade transcription baked in — you can test on a real call
          at the end.
        </p>

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
              job={job}
              onJob={(v) => { setJob(v); setPersonalityTouched(true) }}
              guardrails={guardrails}
              onGuardrails={(v) => { setGuardrails(v); setPersonalityTouched(true) }}
              rawMode={rawMode}
              onRawMode={setRawMode}
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
              engine={engine}
              mode={phoneMode}
              onMode={setPhoneMode}
              countryCode={countryCode}
              onCountryCode={setCountryCode}
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
              engine={engine}
              outboundEnabled={!!purchasedNumber}
            />
          )}
        </div>

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
        What&apos;s this voice agent for?
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
        Pick the closest fit. The template seeds the opening line, prompt, and tone — you&apos;ll edit it in the next steps.
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
  return (
    <div>
      <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        Pick a voice
      </h2>
      <p className="text-sm mb-5" style={{ color: 'var(--text-tertiary)' }}>
        Gemini is a native speech-to-speech voice — it hears and speaks audio
        directly, so it sounds the most human. Prefer the classic phone stack?
        Switch to Standard or ElevenLabs.
      </p>
      <div
        className="inline-flex items-center gap-1 p-1 rounded-lg mb-5"
        style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}
      >
        {([
          { id: 'cartesia' as const,   label: 'Natural — most human' },
          { id: 'vapi' as const,       label: 'Standard' },
          { id: 'elevenlabs' as const, label: 'ElevenLabs' },
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
  name, onName, firstMessage, onFirstMessage,
  job, onJob, guardrails, onGuardrails, rawMode, onRawMode,
  systemPrompt, onSystemPrompt,
  endCallMessage, onEndCallMessage, formalityLevel, onFormality,
}: {
  name: string; onName: (v: string) => void
  firstMessage: string; onFirstMessage: (v: string) => void
  job: string; onJob: (v: string) => void
  guardrails: string; onGuardrails: (v: string) => void
  rawMode: boolean; onRawMode: (v: boolean) => void
  systemPrompt: string; onSystemPrompt: (v: string) => void
  endCallMessage: string; onEndCallMessage: (v: string) => void
  formalityLevel: number; onFormality: (v: number) => void
}) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        Personality &amp; opening line
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
        How the agent introduces itself and what it helps callers with.
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

        {/* Plain-language prompt builder (default) vs. raw escape hatch.
            Most operators only ever touch the two friendly fields; the
            "Edit raw instructions" toggle exposes the full prompt for
            power users without making it the default surface. */}
        <div className="flex items-center justify-between">
          <label className="block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            {rawMode ? 'Raw instructions' : 'What should this agent do?'}
          </label>
          <button
            type="button"
            onClick={() => onRawMode(!rawMode)}
            className="text-[11px] underline"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {rawMode ? 'Use simple fields' : 'Edit raw instructions'}
          </button>
        </div>

        {rawMode ? (
          <textarea
            value={systemPrompt}
            onChange={e => onSystemPrompt(e.target.value)}
            rows={10}
            className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none font-mono"
            style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
          />
        ) : (
          <>
            <div>
              <textarea
                value={job}
                onChange={e => onJob(e.target.value)}
                rows={5}
                placeholder="e.g. You answer calls for Acme Plumbing. Greet the caller warmly, find out what they need, and book them in for a visit."
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Describe the agent&apos;s job in plain English — what it&apos;s for, who it&apos;s talking to, and what a good call looks like.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Anything it should always or never do? <span style={{ color: 'var(--text-muted)' }}>(optional)</span></label>
              <textarea
                value={guardrails}
                onChange={e => onGuardrails(e.target.value)}
                rows={3}
                placeholder="e.g. Never quote a price over the phone. Always offer to text a confirmation."
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
              />
            </div>
          </>
        )}
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
              {formalityLevel < 33 ? 'Casual' : formalityLevel < 67 ? 'Conversational' : 'Professional'}
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
          ['none', 'No knowledge', 'Agent answers from the system prompt only'],
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
  engine, mode, onMode, countryCode, onCountryCode, areaCode, onAreaCode,
  purchasedNumber, purchasing, error, onPurchase,
}: {
  engine: Engine
  mode: 'buy' | 'skip' | 'port'
  onMode: (m: 'buy' | 'skip' | 'port') => void
  countryCode: string
  onCountryCode: (v: string) => void
  areaCode: string
  onAreaCode: (v: string) => void
  purchasedNumber: PhoneNumberOption | null
  purchasing: boolean
  error: string | null
  onPurchase: () => void
}) {
  // Gemini provisions its Twilio number on the final step (after the
  // agent row exists, so the number can be persisted to GeminiVoiceConfig
  // and the inbound router can resolve it). Nothing to do here — just
  // tell the operator where the number lives.
  if (engine === 'gemini') {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
          Phone number
        </h2>
        <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
          Where calls come in and go out from.
        </p>
        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-start gap-3">
            <div className="text-2xl leading-none">📞</div>
            <div>
              <div className="font-medium text-sm mb-1" style={{ color: 'var(--text-primary)' }}>
                Your phone number is set up on the next step
              </div>
              <div className="text-xs leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
                We&apos;ll provision a dedicated number for this agent right after it&apos;s
                created — so it&apos;s wired straight to your new agent. You can also test in
                the browser first without a number.
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }
  // Vapi sells provider-managed numbers in these countries. US is the
  // only one on the free tier — the rest need billing enabled at
  // dashboard.vapi.ai. We surface them all and let the operator deal with
  // Vapi's billing prompt if it fires.
  const countryOptions = [
    { code: 'US', label: '🇺🇸 United States', areaHint: 'e.g. 415', requireArea: true,  prefix: '+1' },
    { code: 'AU', label: '🇦🇺 Australia',     areaHint: 'optional, e.g. 02', requireArea: false, prefix: '+61' },
    { code: 'GB', label: '🇬🇧 United Kingdom', areaHint: 'optional, e.g. 20', requireArea: false, prefix: '+44' },
    { code: 'CA', label: '🇨🇦 Canada',         areaHint: 'e.g. 416', requireArea: true,  prefix: '+1' },
    { code: 'NZ', label: '🇳🇿 New Zealand',    areaHint: 'optional, e.g. 9',  requireArea: false, prefix: '+64' },
  ]
  const active = countryOptions.find(c => c.code === countryCode) || countryOptions[0]
  const areaInvalid = active.requireArea && !areaCode

  return (
    <div>
      <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
        Phone number
      </h2>
      <p className="text-sm mb-6" style={{ color: 'var(--text-tertiary)' }}>
        Where calls come in and go out from. You can skip this and add one later — browser testing still works without a number.
      </p>
      <div className="space-y-3">
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
              <div className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
                Provision a new phone number for this agent. US numbers are included on every workspace; AU / GB / CA / NZ numbers are part of the international plan — if your workspace isn&apos;t on it yet, the request returns a friendly error with a contact-support link.
              </div>
              {mode === 'buy' && (
                <div>
                  {purchasedNumber ? (
                    <div className="space-y-1">
                      <div className="text-sm font-medium" style={{ color: '#22c55e' }}>
                        ✓ {purchasedNumber.number}
                      </div>
                      <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        Carrier wire-up takes 30 seconds to 2 minutes — if the Try-it dial fails right away, wait a moment and retry.
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        value={countryCode}
                        onChange={e => { onCountryCode(e.target.value); onAreaCode('') }}
                        className="rounded-lg px-3 py-2 text-sm focus:outline-none"
                        style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
                      >
                        {countryOptions.map(c => (
                          <option key={c.code} value={c.code}>{c.label}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={areaCode}
                        onChange={e => onAreaCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder={active.areaHint}
                        className="w-36 rounded-lg px-3 py-2 text-sm focus:outline-none"
                        style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
                      />
                      <button
                        type="button"
                        onClick={onPurchase}
                        disabled={areaInvalid || purchasing}
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
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Twilio / Vonage / 8x8 numbers can be ported in. Email support@voxility.ai and we&apos;ll connect it for you.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TryItStep({
  workspaceId, agentId, submitting, error, onCreate, hasSelection,
  agentName, voiceId, firstMessage, engine, outboundEnabled,
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
  engine: Engine
  outboundEnabled: boolean
}) {
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
        We&apos;ll create the agent and bring up a phone simulator. Test in your browser or dial out to a real number.
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
      ) : engine === 'gemini' ? (
        // Gemini is a native speech-to-speech runtime. VoicePhoneCallUI is
        // now runtime-aware, so the in-browser test runs right here — no
        // need to bounce the user to the config page to hear their agent.
        <div className="space-y-5">
          <p className="text-sm font-medium" style={{ color: '#22c55e' }}>
            ✓ Your Gemini voice agent is live. Tap “Test call in browser” to hear it.
          </p>
          <VoicePhoneCallUI
            workspaceId={workspaceId}
            agentId={agentId}
            agentName={agentName}
            voiceId={voiceId}
            firstMessage={firstMessage}
            ttsProvider="vapi"
            locationId={locationId ?? ''}
            voiceRuntime="gemini"
            outboundEnabled={false}
          />
          <div>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              Get a phone number
            </h3>
            <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
              Provision a dedicated number so callers can reach this agent.
            </p>
            <GeminiPhoneNumberPanel
              workspaceId={workspaceId}
              agentId={agentId}
              currentNumber={null}
              onProvisioned={() => {}}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <VoicePhoneCallUI
            workspaceId={workspaceId}
            agentId={agentId}
            agentName={agentName}
            voiceId={voiceId}
            firstMessage={firstMessage}
            ttsProvider={engine}
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
