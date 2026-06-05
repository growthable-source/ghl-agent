'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { MergeFieldTextarea, MergeFieldInput } from '@/components/MergeFieldHelper'

interface VapiConfig {
  phoneNumberId: string | null
  phoneNumber: string | null
  /**
   * Which TTS adapter drives this agent. 'vapi' is ElevenLabs via Vapi;
   * 'xai' is Grok. The UI below hides/shows sections based on what the
   * selected provider's capabilities report — e.g. XAI has no phone
   * support today, so the phone-number section collapses for XAI agents.
   */
  ttsProvider: 'vapi' | 'xai'
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
  voiceTools: any[] | null
  isActive: boolean
}

interface ProviderCapabilities {
  phoneCalls: boolean
  realtimeBrowser: boolean
  ttsBatch: boolean
  voicePreview: boolean
  widgetVoice: boolean
}

interface ProviderMeta {
  id: 'vapi' | 'xai'
  name: string
  description: string
  envVar: string
  configured: boolean
  capabilities: ProviderCapabilities
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

  const [config, setConfig] = useState<VapiConfig>({
    phoneNumberId: null, phoneNumber: null,
    ttsProvider: 'vapi',
    voiceId: 'EXAVITQu4vr4xnSDxMaL', voiceName: 'Sarah',
    stability: 0.5, similarityBoost: 0.75, speed: 1.0, style: 0.0,
    firstMessage: '', endCallMessage: '',
    maxDurationSecs: 600, recordCalls: true,
    backgroundSound: null, endCallPhrases: [], language: null,
    voiceTools: null,
    isActive: false,
  })
  // Provider metadata for all known voice providers + live capability map
  // for the currently-selected one. Loaded once on mount.
  const [providers, setProviders] = useState<ProviderMeta[]>([])
  const currentProvider = providers.find(p => p.id === config.ttsProvider) ?? null
  const caps = currentProvider?.capabilities ?? {
    phoneCalls: true, realtimeBrowser: true, ttsBatch: true, voicePreview: true, widgetVoice: true,
  }
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([])
  const [voices, setVoices] = useState<Voice[]>([])
  const [voiceSearch, setVoiceSearch] = useState('')
  const [voiceFilter, setVoiceFilter] = useState<'all' | 'male' | 'female'>('all')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [vapiReady, setVapiReady] = useState(false)
  const [vapiError, setVapiError] = useState<string | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Phone provisioning
  const [showBuyForm, setShowBuyForm] = useState(false)
  const [areaCode, setAreaCode] = useState('')
  const [buying, setBuying] = useState(false)
  const [buyError, setBuyError] = useState('')

  // End call phrases
  const [newPhrase, setNewPhrase] = useState('')

  // Voice picker
  const [showVoicePicker, setShowVoicePicker] = useState(false)

  // Test call state
  const [testCallActive, setTestCallActive] = useState(false)
  const [testCallConnecting, setTestCallConnecting] = useState(false)
  const [testTranscript, setTestTranscript] = useState<{ role: string; text: string }[]>([])
  const [testVolume, setTestVolume] = useState(0)
  const [vapiPublicKey, setVapiPublicKey] = useState<string | null>(null)
  const [testSystemPrompt, setTestSystemPrompt] = useState('')
  const [agentName, setAgentName] = useState('Agent')
  const [serverUrl, setServerUrl] = useState('')
  // For VOICE-typed agents we tweak the intro copy (voice is the
  // channel, not a bolt-on). Fetched on mount alongside the rest of
  // the agent metadata; harmless when it stays default.
  const [agentType, setAgentType] = useState<string>('SIMPLE')
  const vapiInstanceRef = useRef<any>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/vapi`)
        .then(r => r.json())
        .then(({ config: cfg, phoneNumbers: phones, vapiReady: ready, vapiError: ve, vapiPublicKey: pk, testSystemPrompt: sp, agentName: an, serverUrl: su }) => {
          if (cfg) setConfig({ ...cfg, ttsProvider: cfg.ttsProvider ?? 'vapi', voiceTools: cfg.voiceTools || null })
          setPhoneNumbers(phones || [])
          setVapiReady(ready)
          setVapiError(ve || null)
          if (pk) setVapiPublicKey(pk)
          if (sp) setTestSystemPrompt(sp)
          if (an) setAgentName(an)
          if (su) setServerUrl(su)
        }),
      fetch('/api/voice/providers')
        .then(r => r.json())
        .then(({ providers: ps }) => setProviders(ps ?? []))
        .catch(() => {}),
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
        })
        .catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [workspaceId, agentId])

  // Re-fetch voices whenever the TTS provider changes. Keeps the voice
  // list honest (ElevenLabs catalogue vs. Grok's 5) without reloading
  // the whole page.
  useEffect(() => {
    if (loading) return
    fetch(`/api/voices?provider=${config.ttsProvider}`)
      .then(r => r.json())
      .then(({ voices: v }) => setVoices(v || []))
      .catch(() => {})
  }, [config.ttsProvider, loading])

  // Cleanup test call on unmount
  useEffect(() => {
    return () => {
      if (vapiInstanceRef.current) {
        vapiInstanceRef.current.stop()
        vapiInstanceRef.current = null
      }
    }
  }, [])

  const searchVoices = useCallback((term: string) => {
    fetch(`/api/voices?provider=${config.ttsProvider}&search=${encodeURIComponent(term)}`)
      .then(r => r.json())
      .then(({ voices: v }) => setVoices(v || []))
      .catch(() => {})
  }, [config.ttsProvider])

  function playPreview(voiceId: string, previewUrl: string | null) {
    // Grok voices don't come with a static preview URL — synthesise one
    // on-demand through /api/voice/preview so the click-to-play
    // experience still works. ElevenLabs voices always ship a
    // preview_url so we use that directly.
    const url = previewUrl
      ?? (config.ttsProvider === 'xai' ? `/api/voice/preview?engine=xai&voiceId=${encodeURIComponent(voiceId)}` : null)
    if (!url) return
    if (playingId === voiceId) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }
    if (audioRef.current) audioRef.current.pause()
    const audio = new Audio(url)
    audio.onended = () => setPlayingId(null)
    audio.play()
    audioRef.current = audio
    setPlayingId(voiceId)
  }

  function selectVoice(v: Voice) {
    setConfig(c => ({ ...c, voiceId: v.voice_id, voiceName: v.name }))
    setShowVoicePicker(false)
    if (audioRef.current) { audioRef.current.pause(); setPlayingId(null) }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const phone = phoneNumbers.find(p => p.id === config.phoneNumberId)
    const payload = {
      ...config,
      phoneNumber: phone?.number || null,
      voiceTools: config.voiceTools && config.voiceTools.length > 0 ? config.voiceTools : null,
    }
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/vapi`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function buyNumber() {
    if (buying) return
    setBuying(true)
    setBuyError('')
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/vapi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ areaCode: areaCode.trim() }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to provision number')
      setPhoneNumbers(prev => [...prev, data.phone])
      setConfig(c => ({ ...c, phoneNumberId: data.phone.id, phoneNumber: data.phone.number }))
      setShowBuyForm(false)
      setAreaCode('')
    } catch (err: any) { setBuyError(err.message) }
    finally { setBuying(false) }
  }

  // ── Test call handlers ──
  async function startTestCall() {
    if (!vapiPublicKey) return
    setTestCallConnecting(true)
    setTestTranscript([])
    setTestVolume(0)

    try {
      const Vapi = (await import('@vapi-ai/web')).default
      const vapi = new Vapi(vapiPublicKey)
      vapiInstanceRef.current = vapi

      vapi.on('call-start', () => {
        setTestCallConnecting(false)
        setTestCallActive(true)
      })

      vapi.on('call-end', () => {
        setTestCallActive(false)
        setTestCallConnecting(false)
        setTestVolume(0)
        vapiInstanceRef.current = null
      })

      vapi.on('message', (msg: any) => {
        if (msg.type === 'transcript') {
          if (msg.transcriptType === 'final') {
            setTestTranscript(prev => [...prev, { role: msg.role, text: msg.transcript }])
            setTimeout(() => transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' }), 50)
          }
        }
      })

      vapi.on('volume-level', (level: number) => {
        setTestVolume(level)
      })

      vapi.on('error', (err: any) => {
        console.error('[TestCall] error:', err)
        setTestCallActive(false)
        setTestCallConnecting(false)
        vapiInstanceRef.current = null
      })

      const builtInTools = [
        { type: 'function', function: { name: 'get_available_slots', description: 'Get available appointment slots for booking', parameters: { type: 'object', properties: { date: { type: 'string', description: 'Date to check in YYYY-MM-DD format' } }, required: ['date'] } } },
        { type: 'function', function: { name: 'book_appointment', description: 'Book an appointment for the caller', parameters: { type: 'object', properties: { startTime: { type: 'string', description: 'ISO datetime for the appointment' }, name: { type: 'string', description: 'Caller name for the booking' } }, required: ['startTime'] } } },
        { type: 'function', function: { name: 'tag_contact', description: 'Tag the caller contact with a label', parameters: { type: 'object', properties: { tag: { type: 'string', description: 'Tag to apply to the contact' } }, required: ['tag'] } } },
        { type: 'function', function: { name: 'send_sms_followup', description: 'Send an SMS follow-up message to the caller after the call', parameters: { type: 'object', properties: { message: { type: 'string', description: 'The SMS message to send after the call' } }, required: ['message'] } } },
      ]
      const customTools = (config.voiceTools || []).map(({ condition, ...rest }: any) => rest)

      await vapi.start({
        name: agentName,
        model: {
          provider: 'anthropic' as any,
          model: 'claude-sonnet-4-20250514' as any,
          messages: [{ role: 'system' as any, content: testSystemPrompt + '\n\n## VOICE CALL INSTRUCTIONS\nYou are on a live phone call. Speak naturally and conversationally. Keep responses SHORT — 1-3 sentences max.' }],
          tools: [...builtInTools, ...customTools] as any,
        },
        voice: {
          provider: '11labs' as any,
          voiceId: config.voiceId as any,
          stability: config.stability,
          similarityBoost: config.similarityBoost,
          speed: config.speed,
          style: config.style,
          ...(config.language ? { language: config.language } : {}),
        } as any,
        firstMessage: config.firstMessage || `Hi there! This is ${agentName}. How can I help you today?`,
        endCallMessage: config.endCallMessage || 'Thanks for calling. Have a great day!',
        maxDurationSeconds: config.maxDurationSecs,
        ...(config.backgroundSound ? { backgroundSound: config.backgroundSound } : {}),
        ...(config.endCallPhrases?.length ? { endCallPhrases: config.endCallPhrases } : {}),
        server: { url: serverUrl },
      } as any)
    } catch (err) {
      console.error('[TestCall] start error:', err)
      setTestCallConnecting(false)
      setTestCallActive(false)
    }
  }

  function stopTestCall() {
    vapiInstanceRef.current?.stop()
    setTestCallActive(false)
    setTestCallConnecting(false)
    setTestVolume(0)
    vapiInstanceRef.current = null
  }

  const filteredVoices = voices.filter(v => {
    if (voiceFilter === 'male') return v.labels?.gender === 'male'
    if (voiceFilter === 'female') return v.labels?.gender === 'female'
    return true
  })

  const selectedVoice = voices.find(v => v.voice_id === config.voiceId)

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p></div>

  return (
    <div className="p-8 max-w-2xl">
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

      {!vapiReady && (
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
          <p className="text-sm font-semibold" style={{ color: 'var(--accent-red)' }}>Vapi API error</p>
          <p className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>{vapiError}</p>
        </div>
      )}

      <form onSubmit={save} className="space-y-6">

        {/* ── Enable toggle ── */}
        <div className="flex items-center justify-between rounded-xl border px-5 py-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Enable Voice</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>Answer inbound calls on the configured number</p>
          </div>
          <button type="button" disabled={!vapiReady}
            onClick={() => setConfig(c => ({ ...c, isActive: !c.isActive }))}
            className="relative inline-flex h-6 w-11 rounded-full border-2 border-transparent transition-colors disabled:opacity-40"
            style={{ background: config.isActive ? 'var(--accent-emerald)' : 'var(--toggle-off-bg)' }}>
            <span className={`inline-block h-5 w-5 transform rounded-full shadow transition-transform ${config.isActive ? 'translate-x-5' : 'translate-x-0'}`} style={{ background: '#fff' }} />
          </button>
        </div>

        {/* ── TTS provider picker ── */}
        {providers.length > 0 && (
          <div className="rounded-xl border p-5 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Voice Provider</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>Which TTS stack powers this agent&apos;s voice. Each provider exposes different voices and capabilities.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {providers.map(p => {
                const selected = config.ttsProvider === p.id
                return (
                  <button key={p.id} type="button"
                    onClick={() => setConfig(c => ({ ...c, ttsProvider: p.id }))}
                    className="text-left rounded-lg border p-3 transition-colors"
                    style={{
                      borderColor: selected ? 'var(--accent-primary)' : 'var(--border)',
                      background: selected ? 'var(--surface-secondary)' : 'transparent',
                      opacity: !p.configured ? 0.7 : 1,
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{p.name}</span>
                      {!p.configured && (
                        <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Needs {p.envVar}</span>
                      )}
                    </div>
                    <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>{p.description}</p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {p.capabilities.phoneCalls && <Chip>Phone</Chip>}
                      {p.capabilities.widgetVoice && <Chip>Widget</Chip>}
                      {p.capabilities.realtimeBrowser && <Chip>Browser</Chip>}
                      {p.capabilities.ttsBatch && <Chip>TTS</Chip>}
                    </div>
                  </button>
                )
              })}
            </div>
            {!caps.phoneCalls && (
              <p className="text-[11px] text-amber-400">
                {currentProvider?.name ?? 'This provider'} doesn&apos;t support phone calls yet — the phone-number section below is hidden.
                Use Vapi for phone, or keep this one for widget + browser voice.
              </p>
            )}
          </div>
        )}

        {/* ── Phone number (hidden when the selected provider can't do phone) ── */}
        {caps.phoneCalls && (
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
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Provision a US phone number via Vapi. Optionally specify a preferred area code.</p>
                <div className="flex gap-2">
                  <input type="text" value={areaCode}
                    onChange={e => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
                    placeholder="Area code (optional, e.g. 415)"
                    className="flex-1 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none"
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
              <select value={config.phoneNumberId || ''}
                onChange={e => {
                  const phone = phoneNumbers.find(ph => ph.id === e.target.value)
                  setConfig(c => ({ ...c, phoneNumberId: e.target.value, phoneNumber: phone?.number || null }))
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

          {/* Current selection */}
          {!showVoicePicker && (
            <div className="flex items-center gap-3 rounded-lg px-4 py-3" style={{ background: 'var(--surface-secondary)' }}>
              <button type="button"
                onClick={() => playPreview(config.voiceId, selectedVoice?.preview_url || null)}
                className="w-9 h-9 rounded-full flex items-center justify-center transition-colors flex-shrink-0"
                style={{ background: 'var(--surface-tertiary)', color: 'var(--text-primary)' }}>
                {playingId === config.voiceId ? '⏸' : '▶'}
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{config.voiceName || config.voiceId.slice(0, 12)}</p>
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
                  const isSelected = config.voiceId === v.voice_id
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
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs flex-shrink-0 transition-colors"
                        style={{ background: 'var(--surface-tertiary)', color: 'var(--text-primary)' }}>
                        {playingId === v.voice_id ? '⏸' : '▶'}
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

        {/* ── Voice tuning ── */}
        {/*
          Stability / Similarity / Style are 11Labs-specific parameters and
          only get applied on the Vapi path (which uses 11Labs underneath).
          XAI's realtime API doesn't accept any tuning parameters today —
          its session.update only takes voice id + audio format. So we
          show the sliders disabled with a clear note when the workspace
          is on XAI, rather than letting users drag them and wonder why
          nothing changes.
        */}
        <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Voice Tuning</p>
          {config.ttsProvider === 'xai' && (
            <div
              className="rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)', color: 'var(--text-secondary)' }}
            >
              These settings only apply to <strong>11Labs</strong> voices (via Vapi). XAI voices use the model&apos;s default delivery — switch to a Vapi voice in the provider picker above to use these controls.
            </div>
          )}
          <fieldset disabled={config.ttsProvider === 'xai'} className={config.ttsProvider === 'xai' ? 'opacity-50 pointer-events-none' : ''}>
            <div className="space-y-4">
              <SliderField label="Speed" desc="How fast the agent speaks. 1.0 is normal." value={config.speed}
                onChange={v => setConfig(c => ({ ...c, speed: v }))} min={0.5} max={2.0} step={0.05}
                format={v => `${v.toFixed(2)}x`} />
              <SliderField label="Stability" desc="Higher = more consistent, lower = more expressive and varied." value={config.stability}
                onChange={v => setConfig(c => ({ ...c, stability: v }))} />
              <SliderField label="Clarity + Similarity" desc="Higher = closer to original voice, slightly more latency." value={config.similarityBoost}
                onChange={v => setConfig(c => ({ ...c, similarityBoost: v }))} />
              <SliderField label="Style Exaggeration" desc="Amplifies the voice style. 0 is neutral. Higher values add more character." value={config.style}
                onChange={v => setConfig(c => ({ ...c, style: v }))} />
            </div>
          </fieldset>
        </div>

        {/* ── Messages ── */}
        <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Call Messages</p>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Opening Message</label>
            <MergeFieldTextarea value={config.firstMessage || ''}
              onChange={e => setConfig(c => ({ ...c, firstMessage: e.target.value }))}
              onValueChange={v => setConfig(c => ({ ...c, firstMessage: v }))}
              placeholder="Hi {{contact.first_name|there}}! How can I help you today?"
              rows={2}
              className="w-full rounded-lg pl-3 pr-3 pt-8 pb-2.5 text-sm focus:outline-none resize-none"
              style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', borderWidth: 1, borderStyle: 'solid' }} />
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>First thing the agent says when the call connects.</p>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Closing Message</label>
            <MergeFieldInput value={config.endCallMessage || ''}
              onChange={e => setConfig(c => ({ ...c, endCallMessage: e.target.value }))}
              onValueChange={v => setConfig(c => ({ ...c, endCallMessage: v }))}
              placeholder="Thanks for calling. Have a great day!"
              className="w-full rounded-lg px-3 py-2.5 text-sm focus:outline-none"
              style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', borderWidth: 1, borderStyle: 'solid' }} />
          </div>
        </div>

        {/* ── Call Settings ── */}
        <div className="rounded-xl border p-5 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Call Settings</p>

          {/* Max duration */}
          <SliderField label="Max Call Duration" desc="" value={config.maxDurationSecs}
            onChange={v => setConfig(c => ({ ...c, maxDurationSecs: v }))} min={60} max={1800} step={60}
            format={v => `${Math.floor(v / 60)} min`} />

          {/* Language */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Language</label>
            <select value={config.language || ''}
              onChange={e => setConfig(c => ({ ...c, language: e.target.value || null }))}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', borderWidth: 1, borderStyle: 'solid' }}>
              {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>

          {/* Background sound */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Background Sound</label>
            <select value={config.backgroundSound || ''}
              onChange={e => setConfig(c => ({ ...c, backgroundSound: e.target.value || null }))}
              className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
              style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', borderWidth: 1, borderStyle: 'solid' }}>
              {BACKGROUND_SOUNDS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          {/* Record calls toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>Record Calls</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Save audio recordings with transcripts</p>
            </div>
            <button type="button" onClick={() => setConfig(c => ({ ...c, recordCalls: !c.recordCalls }))}
              className="relative inline-flex h-6 w-11 rounded-full border-2 border-transparent transition-colors"
              style={{ background: config.recordCalls ? 'var(--accent-emerald)' : 'var(--toggle-off-bg)' }}>
              <span className={`inline-block h-5 w-5 transform rounded-full shadow transition-transform ${config.recordCalls ? 'translate-x-5' : 'translate-x-0'}`} style={{ background: '#fff' }} />
            </button>
          </div>

          {/* End call phrases */}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>End Call Phrases</label>
            <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>If the caller says one of these, the agent will end the call.</p>
            {config.endCallPhrases.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {config.endCallPhrases.map((p, i) => (
                  <span key={i} className="flex items-center gap-1 text-xs rounded-full px-2.5 py-1"
                    style={{ background: 'var(--surface-tertiary)', color: 'var(--text-secondary)' }}>
                    {p}
                    <button type="button" onClick={() => setConfig(c => ({
                      ...c, endCallPhrases: c.endCallPhrases.filter((_, idx) => idx !== i)
                    }))} className="ml-0.5 hover:text-red-400" style={{ color: 'var(--text-tertiary)' }}>×</button>
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
                    setConfig(c => ({ ...c, endCallPhrases: [...c.endCallPhrases, newPhrase.trim()] }))
                    setNewPhrase('')
                  }
                }}
                placeholder="e.g. goodbye, that's all, hang up"
                className="flex-1 rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)', borderWidth: 1, borderStyle: 'solid' }} />
              <button type="button" disabled={!newPhrase.trim()}
                onClick={() => {
                  if (newPhrase.trim()) {
                    setConfig(c => ({ ...c, endCallPhrases: [...c.endCallPhrases, newPhrase.trim()] }))
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

        {/* ── Voice Tools ── */}
        <div className="rounded-xl border p-5 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Voice Tools</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              The voice agent automatically uses the same tools configured on the <Link href={`/dashboard/${workspaceId}/agents/${agentId}/tools`} className="text-blue-400 hover:text-blue-300">Tools tab</Link>. These voice-specific tools are always available:
            </p>
          </div>
          <div className="space-y-1.5">
            {[
              { name: 'get_available_slots', desc: 'Check calendar availability' },
              { name: 'book_appointment', desc: 'Book a meeting for the caller' },
              { name: 'tag_contact', desc: 'Tag the caller in the CRM' },
              { name: 'send_sms_followup', desc: 'Send an SMS after the call ends' },
            ].map(tool => (
              <div key={tool.name} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: 'var(--surface-secondary)' }}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--accent-emerald)' }} />
                <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{tool.name}</span>
                <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>{tool.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Webhook info ── */}
        <div className="rounded-xl border px-5 py-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Inbound Webhook</p>
          <code className="text-xs px-2 py-1 rounded block" style={{ background: 'var(--surface-secondary)', color: 'var(--text-secondary)' }}>{typeof window !== 'undefined' ? window.location.origin : 'https://voxilityai.vercel.app'}/api/vapi/webhook</code>
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>Configured automatically for numbers provisioned above.</p>
        </div>

        <button type="submit" disabled={saving || !vapiReady}
          className="w-full inline-flex items-center justify-center rounded-lg font-medium text-sm h-10 transition-colors"
          style={{
            background: (saving || !vapiReady) ? 'var(--surface-tertiary)' : 'var(--accent-primary)',
            color: (saving || !vapiReady) ? 'var(--text-tertiary)' : 'var(--btn-primary-text)',
            cursor: (saving || !vapiReady) ? 'not-allowed' : 'pointer',
            opacity: (saving || !vapiReady) ? 0.6 : 1,
          }}>
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Voice Settings'}
        </button>
      </form>

      {/* xAI test panel removed — Grok now runs through Vapi too.
          Both engines share the existing Vapi test-call panel below. */}

      {/* ── Test Call Panel — Vapi browser SDK powers both engines ── */}
      {vapiReady && vapiPublicKey && (
        <div className="mt-6 rounded-xl border p-5 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Test Call</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>Talk to your voice agent live in the browser. Uses your microphone.</p>
            </div>
            {!testCallActive && !testCallConnecting ? (
              <button type="button" onClick={startTestCall}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                style={{ background: 'var(--accent-emerald)', color: '#fff' }}>
                <span className="w-2 h-2 rounded-full" style={{ background: '#fff' }} />
                Start call
              </button>
            ) : (
              <button type="button" onClick={stopTestCall}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-sm font-medium transition-colors flex items-center gap-2"
                style={{ color: '#fff' }}>
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#fff' }} />
                {testCallConnecting ? 'Connecting…' : 'End call'}
              </button>
            )}
          </div>

          {/* Volume indicator */}
          {(testCallActive || testCallConnecting) && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="w-1 rounded-full transition-all duration-75"
                      style={{
                        height: `${8 + (i * 1.5)}px`,
                        background: i / 12 < testVolume ? 'var(--accent-emerald)' : 'var(--surface-tertiary)',
                      }} />
                  ))}
                </div>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {testCallConnecting ? 'Connecting…' : testCallActive ? 'Connected' : ''}
                </span>
              </div>
            </div>
          )}

          {/* Live transcript */}
          {testTranscript.length > 0 && (
            <div ref={transcriptRef} className="max-h-64 overflow-y-auto space-y-2 rounded-lg p-3" style={{ background: 'var(--surface-secondary)' }}>
              {testTranscript.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-blue-600/20 text-blue-400 border border-blue-800/30'
                      : ''
                  }`}
                  style={msg.role === 'user' ? undefined : {
                    background: 'var(--surface-tertiary)',
                    color: 'var(--text-secondary)',
                    borderWidth: 1,
                    borderStyle: 'solid',
                    borderColor: 'var(--border-secondary)',
                  }}>
                    <p className="text-xs mb-0.5" style={{ color: 'var(--text-tertiary)' }}>{msg.role === 'user' ? 'You' : agentName}</p>
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!testCallActive && !testCallConnecting && testTranscript.length === 0 && (
            <div className="text-center py-6">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center" style={{ background: 'var(--surface-secondary)' }}>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ color: 'var(--text-tertiary)' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Click Start call to test your agent. You'll need to allow microphone access.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Small capability chip used in the provider picker cards.
function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-medium rounded px-1.5 py-0.5"
      style={{ color: 'var(--text-secondary)', background: 'var(--surface-secondary)', borderColor: 'var(--border)', borderWidth: 1, borderStyle: 'solid' }}>
      {children}
    </span>
  )
}
