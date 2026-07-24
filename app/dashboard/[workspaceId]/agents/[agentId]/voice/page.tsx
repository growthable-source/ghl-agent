'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { MergeFieldTextarea, MergeFieldInput } from '@/components/MergeFieldHelper'
import AgentCrmCard from '@/components/agents/AgentCrmCard'
import SaveBar from '@/components/dashboard/SaveBar'
import { useDirtyForm } from '@/lib/use-dirty-form'
import { voicePreviewUrl } from '@/lib/voice/preview-url'
import { useVoicePreview } from '@/lib/voice/use-voice-preview'

interface VapiConfig {
  phoneNumberId: string | null
  phoneNumber: string | null
  /**
   * Which TTS engine Vapi should route to:
   *   'vapi'       → Vapi-native voices (Elliot et al.) — the new default
   *   'elevenlabs' → ElevenLabs 5000+ catalogue with full tuning
   * Tuning sliders (stability/similarityBoost/speed/style) only apply
   * to ElevenLabs voices; the UI hides them on Vapi-native.
   */
  ttsProvider: 'vapi' | 'elevenlabs' | 'cartesia'
  voiceId: string
  voiceName: string | null
  stability: number
  similarityBoost: number
  speed: number
  style: number
  firstMessage: string | null
  endCallMessage: string | null
  maxDurationSecs: number
  recordCalls: boolean
  backgroundSound: string | null
  endCallPhrases: string[]
  language: string | null
  transferPhoneNumber: string | null
  voicemailMessage: string | null
  voiceTools: any[] | null
  isActive: boolean
}

/**
 * The form this page edits. VapiConfig is saved to the VapiConfig row;
 * systemPrompt lives on Agent and is what the model actually receives on
 * every call (lib/voice/vapi-assistant.ts). It used to be editable only in
 * the creation wizard — after that the prompt was reachable only through
 * Advanced → Identity, which is a read-only preview. Voice agents are
 * mostly prompt, so it belongs on the page named "Voice & Script".
 */
type VoiceForm = VapiConfig & { systemPrompt: string }

const DEFAULT_CONFIG: VapiConfig = {
  phoneNumberId: null, phoneNumber: null,
  // Default to Cartesia (Sonic) — Vapi's own default provider and the
  // most human-sounding voice. With CARTESIA_API_KEY set, previews synth
  // on demand AND calls run through Vapi. Katie is a warm conversational
  // starting voice; the picker offers the rest.
  ttsProvider: 'cartesia',
  voiceId: 'f786b574-daa5-4673-aa0c-cbe3e8534c02', voiceName: 'Katie',
  stability: 0.5, similarityBoost: 0.75, speed: 1.0, style: 0.0,
  firstMessage: '', endCallMessage: '',
  maxDurationSecs: 600, recordCalls: true,
  backgroundSound: null, endCallPhrases: [], language: null,
  transferPhoneNumber: null, voicemailMessage: null,
  voiceTools: null,
  isActive: false,
}

interface PhoneNumber {
  id: string
  number: string
  name: string
}

interface Voice {
  voice_id: string
  name: string
  preview_url: string | null
  labels: Record<string, string>
  category: string
}

const BACKGROUND_SOUNDS = [
  { value: '', label: 'None' },
  { value: 'office', label: 'Office' },
  { value: 'off-grid-cabin', label: 'Off-grid Cabin' },
]

const LANGUAGES = [
  { value: '', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
  { value: 'pl', label: 'Polish' },
  { value: 'nl', label: 'Dutch' },
  { value: 'sv', label: 'Swedish' },
  { value: 'tr', label: 'Turkish' },
]

function SliderField({ label, desc, value, onChange, min = 0, max = 1, step = 0.05, format }: {
  label: string; desc: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; format?: (v: number) => string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</label>
        <span className="text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5"
        style={{ accentColor: 'var(--accent-primary)' }} />
      <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{desc}</p>
    </div>
  )
}

export default function VoicePage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [initial, setInitial] = useState<VoiceForm | null>(null)
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([])
  const [voices, setVoices] = useState<Voice[]>([])
  const [voiceSearch, setVoiceSearch] = useState('')
  const [voiceFilter, setVoiceFilter] = useState<'all' | 'male' | 'female'>('all')
  const [loading, setLoading] = useState(true)
  const [vapiReady, setVapiReady] = useState(false)
  const [vapiError, setVapiError] = useState<string | null>(null)
  // Set when the settings GET itself fails (500/401), as opposed to it
  // succeeding and reporting Vapi keys missing. Keeping the two apart
  // stops a server fault from rendering as "add VAPI_API_KEY" — which
  // once sent an operator chasing env vars when the real cause was an
  // unapplied DB migration crashing the route.
  const [loadError, setLoadError] = useState<string | null>(null)
  // Shared with the voice wizard — see lib/voice/use-voice-preview.
  const preview = useVoicePreview()
  const playingId = preview.playingId


  // Phone provisioning
  const [showBuyForm, setShowBuyForm] = useState(false)
  const [areaCode, setAreaCode] = useState('')
  // Country code for the buy-a-number flow. US is the only free-tier
  // option; AU / GB / CA / NZ require billing on Vapi.
  const [buyCountryCode, setBuyCountryCode] = useState('US')
  const [buying, setBuying] = useState(false)
  const [buyError, setBuyError] = useState('')

  // End call phrases
  const [newPhrase, setNewPhrase] = useState('')

  // Voice picker
  const [showVoicePicker, setShowVoicePicker] = useState(false)

  // Advanced settings disclosure — closed by default. The defaults on
  // VapiConfig (recordCalls, language auto-detect, 10-min max) are good
  // enough that a non-technical operator never has to open this.
  const [showAdvanced, setShowAdvanced] = useState(false)

  // When a Vapi sync error is the opaque provider/model rejection, we show
  // a friendly line and tuck the raw message behind this toggle.
  const [showSyncDetails, setShowSyncDetails] = useState(false)

  // For VOICE-typed agents we tweak the intro copy (voice is the
  // channel, not a bolt-on). Fetched on mount alongside the rest of
  // the agent metadata; harmless when it stays default.
  const [agentType, setAgentType] = useState<string>('SIMPLE')

  // Booking calendar. With one connected, the agent checks availability +
  // books on the call; either way it captures the caller's name/email to
  // the CRM. Stored as Agent.calendarId, saved via the agent PATCH.
  const [calendars, setCalendars] = useState<Array<{ id: string; name: string }>>([])
  const [calendarId, setCalendarId] = useState<string>('')
  const [savingCalendar, setSavingCalendar] = useState(false)

  async function saveCalendar(id: string) {
    setCalendarId(id)
    setSavingCalendar(true)
    try {
      await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarId: id || null }),
      })
    } catch { /* non-fatal */ }
    finally { setSavingCalendar(false) }
  }

  // Test call previously lived inline here as a 100-line transient-
  // assistant block. It was the pre-Round-3 path — different shape,
  // no query_knowledge tool, no Shopify tools, hardcoded ElevenLabs
  // provider regardless of engine. The Overview tab's test call
  // (powered by VoicePhoneCallUI → pre-registered assistant) is the
  // only one that gets every runtime fix. This page just links to it.

  useEffect(() => {
    // Both the VapiConfig row and the agent's systemPrompt feed one form,
    // so the baseline isn't set until both land — otherwise useDirtyForm
    // would take an incomplete snapshot and the second arrival would read
    // as an unsaved change.
    let loadedConfig: VapiConfig | null = null
    let loadedPrompt = ''

    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/vapi`)
        .then(async r => {
          const data = await r.json().catch(() => ({}))
          if (!r.ok) {
            setLoadError(data?.error || `Voice settings failed to load (HTTP ${r.status}).`)
            return
          }
          const { config: cfg, phoneNumbers: phones, vapiReady: ready, vapiError: ve } = data
          if (cfg) loadedConfig = { ...cfg, ttsProvider: cfg.ttsProvider ?? 'vapi', voiceTools: cfg.voiceTools || null }
          setPhoneNumbers(phones || [])
          setVapiReady(ready)
          setVapiError(ve || null)
        })
        .catch(() => setLoadError('Voice settings failed to load — check your connection and refresh.')),
      // Initial voice list uses whatever provider the stored config has —
      // if it's missing we default to vapi. When the user later switches
      // providers, the provider-picker handler re-fetches.
      fetch('/api/voices')
        .then(r => r.json())
        .then(({ voices: v }) => setVoices(v || []))
        .catch(() => {}),
      // Pull agentType separately so we know whether this is a
      // primary-voice agent (different intro copy + the Voice tab is
      // promoted to a top-level hub in the parent layout).
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
        .then(r => r.ok ? r.json() : null)
        .then((d: any) => {
          if (d?.agent?.agentType) setAgentType(d.agent.agentType)
          if (typeof d?.agent?.calendarId === 'string') setCalendarId(d.agent.calendarId)
          loadedPrompt = d?.agent?.systemPrompt ?? ''
        })
        .catch(() => {}),
      // Booking calendars available on this agent's CRM location.
      fetch(`/api/workspaces/${workspaceId}/calendars?agentId=${agentId}`)
        .then(r => r.ok ? r.json() : { calendars: [] })
        .then((d: any) => setCalendars(Array.isArray(d.calendars) ? d.calendars : []))
        .catch(() => {}),
    ]).finally(() => {
      setInitial({ ...(loadedConfig ?? DEFAULT_CONFIG), systemPrompt: loadedPrompt })
      setLoading(false)
    })
  }, [workspaceId, agentId])

  const { draft, set, dirty, saving, savedAt, error, save, reset } = useDirtyForm<VoiceForm>({
    initial,
    onSave: async (d) => {
      const { systemPrompt, ...cfg } = d
      // The prompt goes to the Agent row, the rest to VapiConfig. Prompt
      // first: it's the field the operator is most likely to have just
      // changed, and if the Vapi assistant sync then fails they haven't
      // lost their writing.
      const promptRes = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt }),
      })
      if (!promptRes.ok) {
        const data = await promptRes.json().catch(() => ({}))
        throw new Error(data.error || 'Could not save the instructions.')
      }

      const phone = phoneNumbers.find(p => p.id === cfg.phoneNumberId)
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/vapi`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...cfg,
          phoneNumber: phone?.number || null,
          voiceTools: cfg.voiceTools && cfg.voiceTools.length > 0 ? cfg.voiceTools : null,
        }),
      })
      if (!res.ok) {
        // 422 = config saved to DB but Vapi rejected the assistant sync
        // (the validation gate). Surface the provider's reason rather than
        // letting it show up later as "Meeting ended due to ejection".
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Voice provider rejected the config (HTTP ${res.status}).`)
      }
    },
  })

  // Re-fetch voices whenever the TTS engine changes. Keeps the voice
  // list honest (Vapi-native catalogue vs. ElevenLabs 5000+) without
  // reloading the whole page.
  useEffect(() => {
    if (loading) return
    fetch(`/api/voices?provider=${draft.ttsProvider}`)
      .then(r => r.json())
      .then(({ voices: v }) => setVoices(v || []))
      .catch(() => {})
  }, [draft.ttsProvider, loading])

  const searchVoices = useCallback((term: string) => {
    fetch(`/api/voices?provider=${draft.ttsProvider}&search=${encodeURIComponent(term)}`)
      .then(r => r.json())
      .then(({ voices: v }) => setVoices(v || []))
      .catch(() => {})
  }, [draft.ttsProvider])

  function playPreview(voiceId: string, previewUrl: string | null) {
    preview.play(draft.ttsProvider, voiceId, previewUrl)
  }

  function selectVoice(v: Voice) {
    set({ voiceId: v.voice_id, voiceName: v.name })
    setShowVoicePicker(false)
    preview.stop()
  }

  async function buyNumber() {
    if (buying) return
    setBuying(true)
    setBuyError('')
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/vapi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countryCode: buyCountryCode, areaCode: areaCode.trim() }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to provision number')
      setPhoneNumbers(prev => [...prev, data.phone])
      set({ phoneNumberId: data.phone.id, phoneNumber: data.phone.number })
      setShowBuyForm(false)
      setAreaCode('')
    } catch (err: any) { setBuyError(err.message) }
    finally { setBuying(false) }
  }

  const filteredVoices = voices.filter(v => {
    if (voiceFilter === 'male') return v.labels?.gender === 'male'
    if (voiceFilter === 'female') return v.labels?.gender === 'female'
    return true
  })

  const selectedVoice = voices.find(v => v.voice_id === draft.voiceId)

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p></div>

  return (
    <div className="p-8 max-w-2xl pb-24">
      {agentType === 'VOICE' ? (
        <div className="mb-6">
          <h1 className="text-xl font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>
            Voice configuration
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            Voice is this agent's primary channel. Provider, voice, phone number, and call settings all live here.
          </p>
        </div>
      ) : (
        <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
          Configure inbound call handling. Same knowledge base and brain as SMS.
        </p>
      )}

      {/* Per-agent CRM connection. Voice agents have no Integrations tab
          (their hub is /voice/[agentId]/*), so the shared card lives on
          their configuration home. Text agents get it on /integrations —
          don't double-render for the bolt-on-voice case. */}
      {agentType === 'VOICE' && (
        <AgentCrmCard
          workspaceId={workspaceId}
          agentId={agentId}
          returnTo={`/dashboard/${workspaceId}/voice/${agentId}/configuration`}
        />
      )}

      {loadError && (
        <div
          className="mb-6 rounded-xl border p-4 space-y-1"
          style={{ borderColor: 'var(--accent-red)', background: 'var(--accent-red-bg)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--accent-red)' }}>Couldn&apos;t load voice settings</p>
          <p className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>{loadError}</p>
        </div>
      )}
      {!loadError && !vapiReady && (
        <div
          className="mb-6 rounded-xl border p-4 space-y-2"
          style={{ borderColor: 'var(--accent-amber)', background: 'var(--accent-amber-bg)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--accent-amber)' }}>Voice AI is not configured</p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Add <code className="px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-tertiary)', color: 'var(--text-secondary)' }}>VAPI_API_KEY</code> and{' '}
            <code className="px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-tertiary)', color: 'var(--text-secondary)' }}>VAPI_PUBLIC_KEY</code> to your environment variables, then redeploy.
          </p>
          <Link
            href={`/dashboard/${workspaceId}/integrations`}
            className="inline-block text-xs transition-opacity hover:opacity-80"
            style={{ color: 'var(--accent-blue)' }}
          >
            Go to Integrations →
          </Link>
        </div>
      )}
      {vapiReady && vapiError && (
        <div
          className="mb-6 rounded-xl border p-4 space-y-1"
          style={{ borderColor: 'var(--accent-red)', background: 'var(--accent-red-bg)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--accent-red)' }}>Voice provider error</p>
          <p className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>{vapiError}</p>
        </div>
      )}

      <div className="space-y-6">

        {/* ── Instructions (the system prompt) ──────────────────────────
            First card on the page on purpose. This is the agent's actual
            behaviour; everything below is delivery. */}
        <div className="rounded-xl border p-5 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Instructions</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              What this agent should do on a call — its job, what to ask, what never to say. Your knowledge base and the caller&apos;s CRM details are added automatically on top of this.
            </p>
          </div>
          <textarea
            value={draft.systemPrompt || ''}
            onChange={e => set({ systemPrompt: e.target.value })}
            rows={14}
            placeholder={"You answer the phone for the business.\n\nOn every call:\n- Greet the caller and find out why they're calling\n- Answer questions using the knowledge base\n- Capture their name and email before the call ends\n- If they want to book, offer times and book them in\n\nNever quote prices you're unsure about — offer to have someone call back instead."}
            className="w-full rounded-lg px-3 py-2.5 text-sm leading-relaxed focus:outline-none resize-y font-mono"
            style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', borderWidth: 1, borderStyle: 'solid' }}
          />
          <div className="flex items-center justify-between">
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Plain English works best. Short, specific rules beat long paragraphs.
            </p>
            <span className="text-[11px] font-mono shrink-0 ml-3" style={{ color: 'var(--text-muted)' }}>
              {(draft.systemPrompt || '').length.toLocaleString()} chars
            </span>
          </div>
        </div>

        {/* ── Enable toggle ── */}
        <div className="flex items-center justify-between rounded-xl border px-5 py-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Enable Voice</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>Answer inbound calls on the configured number</p>
          </div>
          <button type="button" disabled={!vapiReady}
            onClick={() => set({ isActive: !draft.isActive })}
            className="relative inline-flex h-6 w-11 rounded-full border-2 border-transparent transition-colors disabled:opacity-40"
            style={{ background: draft.isActive ? 'var(--accent-emerald)' : 'var(--toggle-off-bg)' }}>
            <span className={`inline-block h-5 w-5 transform rounded-full shadow transition-transform ${draft.isActive ? 'translate-x-5' : 'translate-x-0'}`} style={{ background: '#fff' }} />
          </button>
        </div>

        {/* ── Voice engine tabs (built-in / ElevenLabs) ── */}
        {/* Internal note: 'vapi' on VapiConfig.ttsProvider == "Built-in".
            ElevenLabs is exposed as itself because customers may have
            specific voices they want and the name is widely known. */}
        <div className="rounded-xl border p-5 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Voice type</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Natural voices are the most human-sounding and you can preview them right here. Standard and ElevenLabs are alternatives.
            </p>
          </div>
          <div
            className="inline-flex items-center gap-1 p-1 rounded-lg"
            style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}
          >
            {([
              { id: 'cartesia',   label: 'Natural — most human' },
              { id: 'vapi',       label: 'Standard' },
              { id: 'elevenlabs', label: 'ElevenLabs' },
            ] as const).map(opt => {
              const active = draft.ttsProvider === opt.id
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => set({ ttsProvider: opt.id })}
                  className="text-xs font-semibold px-3 py-1.5 rounded-md transition-colors"
                  style={active
                    ? { background: '#fa4d2e', color: '#ffffff' }
                    : { background: 'transparent', color: 'var(--text-secondary)' }
                  }
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Phone number — Vapi owns the bridge for both engines, so
            this section is always visible regardless of voice engine. ── */}
        {(
          <div className="rounded-xl border p-5 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Phone Number</p>
              {vapiReady && (
                <button type="button" onClick={() => { setShowBuyForm(!showBuyForm); setBuyError('') }}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                  {showBuyForm ? 'Cancel' : '+ Get a number'}
                </button>
              )}
            </div>
            {showBuyForm && (
              <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--border-secondary)', background: 'var(--surface-secondary)' }}>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Pick a phone number for this agent. US numbers are free on every plan; other countries may need billing enabled — if so, we&apos;ll let you know and you can contact support.
                </p>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={buyCountryCode}
                    onChange={e => { setBuyCountryCode(e.target.value); setAreaCode('') }}
                    className="rounded-lg px-3 py-2 text-sm focus:outline-none"
                    style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', borderWidth: 1, borderStyle: 'solid' }}
                  >
                    <option value="US">🇺🇸 United States</option>
                    <option value="AU">🇦🇺 Australia</option>
                    <option value="GB">🇬🇧 United Kingdom</option>
                    <option value="CA">🇨🇦 Canada</option>
                    <option value="NZ">🇳🇿 New Zealand</option>
                  </select>
                  <input type="text" value={areaCode}
                    onChange={e => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder={
                      buyCountryCode === 'US' ? 'Area code (e.g. 415)' :
                      buyCountryCode === 'AU' ? 'Area code (optional, e.g. 02)' :
                      buyCountryCode === 'GB' ? 'Area code (optional, e.g. 20)' :
                      buyCountryCode === 'CA' ? 'Area code (e.g. 416)' :
                      'Area code (optional, e.g. 9)'
                    }
                    className="flex-1 min-w-[160px] rounded-lg px-3 py-2 text-sm font-mono focus:outline-none"
                    style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', borderWidth: 1, borderStyle: 'solid' }} />
                  <button type="button" onClick={buyNumber} disabled={buying}
                    className="px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
                    style={{
                      background: buying ? 'var(--surface-tertiary)' : 'var(--accent-primary)',
                      color: buying ? 'var(--text-tertiary)' : 'var(--btn-primary-text)',
                      cursor: buying ? 'not-allowed' : 'pointer',
                      opacity: buying ? 0.6 : 1,
                    }}>
                    {buying ? 'Provisioning…' : 'Get number'}
                  </button>
                </div>
                {buyError && <p className="text-xs text-red-400 mt-2">{buyError}</p>}
              </div>
            )}
            {phoneNumbers.length > 0 ? (
              <select value={draft.phoneNumberId || ''}
                onChange={e => {
                  const phone = phoneNumbers.find(ph => ph.id === e.target.value)
                  set({ phoneNumberId: e.target.value, phoneNumber: phone?.number || null })
                }}
                className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none"
                style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', borderWidth: 1, borderStyle: 'solid' }}>
                <option value="">Select a phone number…</option>
                {phoneNumbers.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.number ?? p.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No numbers yet. Click <span className="text-blue-400">+ Get a number</span> to provision one.</p>
            )}
          </div>
        )}

        {/* ── Voice selection ── */}
        <div className="rounded-xl border p-5 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Voice</p>
            <button type="button" onClick={() => setShowVoicePicker(!showVoicePicker)}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
              {showVoicePicker ? 'Close' : 'Browse voices'}
            </button>
          </div>

          {preview.error && (
            <p className="text-xs mb-2" style={{ color: 'var(--accent-red, #ef4444)' }}>{preview.error}</p>
          )}

          {/* Current selection */}
          {!showVoicePicker && (
            <div className="flex items-center gap-3 rounded-lg px-4 py-3" style={{ background: 'var(--surface-secondary)' }}>
              <button type="button"
                onClick={() => playPreview(draft.voiceId, selectedVoice?.preview_url || null)}
                className="w-9 h-9 rounded-full flex items-center justify-center transition-colors flex-shrink-0"
                style={{ background: 'var(--surface-tertiary)', color: 'var(--text-primary)' }}>
                {preview.loadingId === draft.voiceId ? '…' : playingId === draft.voiceId ? '⏸' : '▶'}
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{draft.voiceName || draft.voiceId.slice(0, 12)}</p>
                {selectedVoice && (
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {[selectedVoice.labels?.gender, selectedVoice.labels?.accent, selectedVoice.labels?.age?.replace('_', ' ')].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => setShowVoicePicker(true)}
                className="text-xs transition-colors" style={{ color: 'var(--text-tertiary)' }}>Change</button>
            </div>
          )}

          {/* Voice picker */}
          {showVoicePicker && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input type="text" value={voiceSearch}
                  onChange={e => { setVoiceSearch(e.target.value); if (e.target.value.length >= 2) searchVoices(e.target.value) }}
                  placeholder="Search by name, accent, style…"
                  className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', borderWidth: 1, borderStyle: 'solid' }} />
                <div className="flex rounded-lg overflow-hidden" style={{ borderColor: 'var(--border-secondary)', borderWidth: 1, borderStyle: 'solid' }}>
                  {(['all', 'female', 'male'] as const).map(f => (
                    <button key={f} type="button" onClick={() => setVoiceFilter(f)}
                      className="px-3 py-2 text-xs capitalize transition-colors"
                      style={{
                        background: voiceFilter === f ? 'var(--surface-tertiary)' : 'transparent',
                        color: voiceFilter === f ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      }}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
                {filteredVoices.map(v => {
                  const isSelected = draft.voiceId === v.voice_id
                  return (
                    <div key={v.voice_id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors"
                      style={{
                        background: isSelected ? 'var(--surface-tertiary)' : 'transparent',
                        borderColor: isSelected ? 'var(--border-secondary)' : 'transparent',
                        borderWidth: 1,
                        borderStyle: 'solid',
                      }}
                      onClick={() => selectVoice(v)}>
                      <button type="button"
                        onClick={e => { e.stopPropagation(); playPreview(v.voice_id, v.preview_url) }}
                        disabled={!voicePreviewUrl(draft.ttsProvider, v.voice_id, v.preview_url)}
                        title={voicePreviewUrl(draft.ttsProvider, v.voice_id, v.preview_url) ? 'Preview' : 'No preview available'}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs flex-shrink-0 transition-colors disabled:opacity-40"
                        style={{ background: 'var(--surface-tertiary)', color: 'var(--text-primary)' }}>
                        {preview.loadingId === v.voice_id ? '…' : playingId === v.voice_id ? '⏸' : '▶'}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{v.name}</p>
                        <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                          {[v.labels?.gender, v.labels?.accent, v.labels?.age?.replace('_', ' '), v.labels?.use_case?.replace('_', ' ')].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {isSelected && <span className="text-xs" style={{ color: 'var(--accent-emerald)' }}>Selected</span>}
                    </div>
                  )
                })}
                {filteredVoices.length === 0 && <p className="text-xs text-center py-4" style={{ color: 'var(--text-tertiary)' }}>No voices match your search.</p>}
              </div>
            </div>
          )}
        </div>

        {/* ── Booking ── */}
        <div className="rounded-xl border p-5 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Booking</p>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
              style={calendarId
                ? { background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }
                : { background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}>
              {calendarId ? 'On' : 'Not set'}
            </span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Pick a calendar and this agent checks availability and books appointments on the call. It always captures the caller&apos;s name and email to your CRM.
          </p>
          <select
            value={calendarId}
            onChange={e => saveCalendar(e.target.value)}
            disabled={savingCalendar}
            className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none disabled:opacity-60"
            style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', borderWidth: 1, borderStyle: 'solid' }}
          >
            <option value="">No booking — answer &amp; capture contacts only</option>
            {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {calendars.length === 0 && (
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              No calendars found for this agent&apos;s CRM. Connect LeadConnector (with calendar access) to enable booking.
            </p>
          )}
        </div>

        {/* ── What the agent says ── */}
        <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>What the agent says</p>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Opening line</label>
            <MergeFieldTextarea value={draft.firstMessage || ''}
              onChange={e => set({ firstMessage: e.target.value })}
              onValueChange={v => set({ firstMessage: v })}
              placeholder="Hi {{contact.first_name|there}}! How can I help you today?"
              rows={2}
              className="w-full rounded-lg pl-3 pr-3 pt-8 pb-2.5 text-sm focus:outline-none resize-none"
              style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', borderWidth: 1, borderStyle: 'solid' }} />
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              The first thing the caller hears. Tip: <code className="px-1 py-0.5 rounded" style={{ background: 'var(--surface-tertiary)' }}>{'{{contact.first_name|there}}'}</code> drops in the caller&apos;s first name, or says &ldquo;there&rdquo; if we don&apos;t know it.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Closing line</label>
            <MergeFieldInput value={draft.endCallMessage || ''}
              onChange={e => set({ endCallMessage: e.target.value })}
              onValueChange={v => set({ endCallMessage: v })}
              placeholder="Thanks for calling. Have a great day!"
              className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none"
              style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', borderWidth: 1, borderStyle: 'solid' }} />
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>How the agent wraps up before hanging up.</p>
          </div>
        </div>

        {/* ── Advanced settings (collapsed) ──────────────────────────────
            Everything below is optional. The VapiConfig defaults (record on,
            auto-detect language, 10-min max) are sensible, so a non-technical
            operator never has to open this. Voice tuning sliders, the voice-
            tools API list, and the inbound webhook were removed entirely —
            they're auto-configured and only confused people. */}
        <div className="rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <button
            type="button"
            onClick={() => setShowAdvanced(s => !s)}
            className="w-full flex items-center justify-between px-5 py-4 text-left"
          >
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Advanced settings</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>Recording, language, call length — optional, sensible defaults are already set.</p>
            </div>
            <span className="text-xs ml-3 shrink-0" style={{ color: 'var(--text-tertiary)' }}>{showAdvanced ? 'Hide' : 'Show'}</span>
          </button>

          {showAdvanced && (
            <div className="px-5 pb-5 space-y-4 border-t" style={{ borderColor: 'var(--border)' }}>
              <div className="pt-4" />

              {/* Record calls toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>Record calls</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Save audio recordings with transcripts</p>
                </div>
                <button type="button" onClick={() => set({ recordCalls: !draft.recordCalls })}
                  className="relative inline-flex h-6 w-11 rounded-full border-2 border-transparent transition-colors"
                  style={{ background: draft.recordCalls ? 'var(--accent-emerald)' : 'var(--toggle-off-bg)' }}>
                  <span className={`inline-block h-5 w-5 transform rounded-full shadow transition-transform ${draft.recordCalls ? 'translate-x-5' : 'translate-x-0'}`} style={{ background: '#fff' }} />
                </button>
              </div>

              {/* Transfer to a human */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Transfer calls to a human</label>
                <input
                  type="tel"
                  value={draft.transferPhoneNumber || ''}
                  onChange={e => set({ transferPhoneNumber: e.target.value.trim() || null })}
                  placeholder="+15551234567"
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', borderWidth: 1, borderStyle: 'solid' }}
                />
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  When set, the agent can hand a live call to this number — when the caller asks for a person, gets frustrated, or needs something the agent can&apos;t do. Include the country code (e.g. +1). Leave empty to disable transfers.
                </p>
              </div>

              {/* Voicemail message */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Voicemail message</label>
                <textarea
                  value={draft.voicemailMessage || ''}
                  onChange={e => set({ voicemailMessage: e.target.value || null })}
                  rows={2}
                  placeholder="Hi, sorry I missed you — I'll try you back shortly."
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none resize-none"
                  style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', borderWidth: 1, borderStyle: 'solid' }}
                />
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>What the agent says if an outbound call reaches an answering machine.</p>
              </div>

              {/* Language */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Language</label>
                <select value={draft.language || ''}
                  onChange={e => set({ language: e.target.value || null })}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', borderWidth: 1, borderStyle: 'solid' }}>
                  {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Leave on Auto-detect unless your callers speak one specific language.</p>
              </div>

              {/* Max duration */}
              <SliderField label="Max call length" desc="The agent hangs up automatically after this long." value={draft.maxDurationSecs}
                onChange={v => set({ maxDurationSecs: v })} min={60} max={1800} step={60}
                format={v => `${Math.floor(v / 60)} min`} />

              {/* Background sound */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Background sound</label>
                <select value={draft.backgroundSound || ''}
                  onChange={e => set({ backgroundSound: e.target.value || null })}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', borderWidth: 1, borderStyle: 'solid' }}>
                  {BACKGROUND_SOUNDS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Subtle ambient noise can make the call feel more natural.</p>
              </div>

              {/* End call phrases */}
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>End-call phrases</label>
                <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>If the caller says one of these, the agent will end the call.</p>
                {draft.endCallPhrases.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {draft.endCallPhrases.map((p, i) => (
                      <span key={i} className="flex items-center gap-1 text-xs rounded-full px-2.5 py-1"
                        style={{ background: 'var(--surface-tertiary)', color: 'var(--text-secondary)' }}>
                        {p}
                        <button type="button" onClick={() => set({ endCallPhrases: draft.endCallPhrases.filter((_, idx) => idx !== i) })} className="ml-0.5 hover:text-red-400" style={{ color: 'var(--text-tertiary)' }}>×</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input type="text" value={newPhrase}
                    onChange={e => setNewPhrase(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newPhrase.trim()) {
                        e.preventDefault()
                        set({ endCallPhrases: [...draft.endCallPhrases, newPhrase.trim()] })
                        setNewPhrase('')
                      }
                    }}
                    placeholder="e.g. goodbye, that's all, hang up"
                    className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
                    style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', borderWidth: 1, borderStyle: 'solid' }} />
                  <button type="button" disabled={!newPhrase.trim()}
                    onClick={() => {
                      if (newPhrase.trim()) {
                        set({ endCallPhrases: [...draft.endCallPhrases, newPhrase.trim()] })
                        setNewPhrase('')
                      }
                    }}
                    className="px-3 py-2 text-sm rounded-lg transition-colors"
                    style={{
                      background: !newPhrase.trim() ? 'var(--surface-tertiary)' : 'var(--accent-primary)',
                      color: !newPhrase.trim() ? 'var(--text-tertiary)' : 'var(--btn-primary-text)',
                      cursor: !newPhrase.trim() ? 'not-allowed' : 'pointer',
                      opacity: !newPhrase.trim() ? 0.6 : 1,
                    }}>Add</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div
            className="rounded-lg border p-3 text-xs space-y-2"
            style={{ borderColor: 'var(--accent-red)', background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}
          >
            <p className="font-semibold">We couldn&apos;t activate this voice agent</p>
            <p style={{ color: 'var(--text-secondary)' }}>
              Your settings were saved. Try clicking Save again — if it keeps failing, contact support and we&apos;ll sort it out.
            </p>
            <button
              type="button"
              onClick={() => setShowSyncDetails(s => !s)}
              className="text-[11px] underline"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {showSyncDetails ? 'Hide technical details' : 'Show technical details'}
            </button>
            {showSyncDetails && (
              <p className="text-[11px] font-mono break-all" style={{ color: 'var(--text-tertiary)' }}>{error}</p>
            )}
          </div>
        )}

        <SaveBar dirty={dirty} saving={saving} savedAt={savedAt} error={error} onSave={save} onReset={reset} />
      </div>

      {/* Test call lives on the Overview tab — one surface, one code path,
          backed by the pre-registered Vapi assistant. The inline duplicate
          that used to live here pre-dated Round 3's assistant registration
          and never picked up query_knowledge or Shopify tool dispatch. */}
      <div
        className="mt-6 rounded-xl border p-4 flex items-center justify-between gap-3"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div className="min-w-0">
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Test this agent
          </p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Browser + outbound dial both live on the Overview tab.
          </p>
        </div>
        <Link
          href={
            agentType === 'VOICE'
              ? `/dashboard/${workspaceId}/voice/${agentId}`
              : `/dashboard/${workspaceId}/agents/${agentId}`
          }
          className="text-xs font-semibold px-3 py-2 rounded-lg whitespace-nowrap"
          style={{ background: 'var(--accent-primary)', color: '#fff' }}
        >
          Open Overview →
        </Link>
      </div>
    </div>
  )
}

