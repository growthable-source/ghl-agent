'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface VapiConfig {
  phoneNumberId: string | null
  phoneNumber: string | null
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
        <label className="text-xs font-medium text-zinc-400">{label}</label>
        <span className="text-xs text-zinc-500 font-mono">{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-white h-1.5" />
      <p className="text-xs text-zinc-600 mt-0.5">{desc}</p>
    </div>
  )
}

export default function VoicePage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [config, setConfig] = useState<VapiConfig>({
    phoneNumberId: null, phoneNumber: null,
    voiceId: 'EXAVITQu4vr4xnSDxMaL', voiceName: 'Sarah',
    stability: 0.5, similarityBoost: 0.75, speed: 1.0, style: 0.0,
    firstMessage: '', endCallMessage: '',
    maxDurationSecs: 600, recordCalls: true,
    backgroundSound: null, endCallPhrases: [], language: null,
    voiceTools: null,
    isActive: false,
  })
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
  const vapiInstanceRef = useRef<any>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/vapi`)
        .then(r => r.json())
        .then(({ config: cfg, phoneNumbers: phones, vapiReady: ready, vapiError: ve, vapiPublicKey: pk, testSystemPrompt: sp, agentName: an, serverUrl: su }) => {
          if (cfg) setConfig({ ...cfg, voiceTools: cfg.voiceTools || null })
          setPhoneNumbers(phones || [])
          setVapiReady(ready)
          setVapiError(ve || null)
          if (pk) setVapiPublicKey(pk)
          if (sp) setTestSystemPrompt(sp)
          if (an) setAgentName(an)
          if (su) setServerUrl(su)
        }),
      fetch('/api/voices')
        .then(r => r.json())
        .then(({ voices: v }) => setVoices(v || []))
        .catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [workspaceId, agentId])

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
    fetch(`/api/voices?search=${encodeURIComponent(term)}`)
      .then(r => r.json())
      .then(({ voices: v }) => setVoices(v || []))
      .catch(() => {})
  }, [])

  function playPreview(voiceId: string, previewUrl: string | null) {
    if (!previewUrl) return
    if (playingId === voiceId) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }
    if (audioRef.current) audioRef.current.pause()
    const audio = new Audio(previewUrl)
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

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-zinc-500 text-sm">Loading…</p></div>

  return (
    <div className="p-8 max-w-2xl">
      <p className="text-sm text-zinc-400 mb-6">Configure inbound call handling. Same knowledge base and brain as SMS.</p>

      {!vapiReady && (
        <div className="mb-6 rounded-xl border border-amber-900/50 bg-amber-950/20 p-4 space-y-2">
          <p className="text-sm text-amber-400 font-medium">Voice AI is not configured</p>
          <p className="text-xs text-zinc-400">
            Add <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-300">VAPI_API_KEY</code> and{' '}
            <code className="bg-zinc-800 px-1.5 py-0.5 rounded text-zinc-300">VAPI_PUBLIC_KEY</code> to your environment variables, then redeploy.
          </p>
          <Link
            href={`/dashboard/${workspaceId}/integrations`}
            className="inline-block text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            Go to Integrations →
          </Link>
        </div>
      )}
      {vapiReady && vapiError && (
        <div className="mb-6 rounded-xl border border-red-900/50 bg-red-950/20 p-4 space-y-1">
          <p className="text-sm text-red-400 font-medium">Vapi API error</p>
          <p className="text-xs font-mono text-zinc-400 break-all">{vapiError}</p>
        </div>
      )}

      <form onSubmit={save} className="space-y-6">

        {/* ── Enable toggle ── */}
        <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950 px-5 py-4">
          <div>
            <p className="text-sm font-medium text-zinc-200">Enable Voice</p>
            <p className="text-xs text-zinc-500 mt-0.5">Answer inbound calls on the configured number</p>
          </div>
          <button type="button" disabled={!vapiReady}
            onClick={() => setConfig(c => ({ ...c, isActive: !c.isActive }))}
            className={`relative inline-flex h-6 w-11 rounded-full border-2 border-transparent transition-colors disabled:opacity-40 ${config.isActive ? 'bg-emerald-500' : 'bg-zinc-700'}`}>
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${config.isActive ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {/* ── Phone number ── */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-zinc-200">Phone Number</p>
            {vapiReady && (
              <button type="button" onClick={() => { setShowBuyForm(!showBuyForm); setBuyError('') }}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                {showBuyForm ? 'Cancel' : '+ Get a number'}
              </button>
            )}
          </div>
          {showBuyForm && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-3 space-y-2">
              <p className="text-xs text-zinc-500">Provision a US phone number via Vapi. Optionally specify a preferred area code.</p>
              <div className="flex gap-2">
                <input type="text" value={areaCode}
                  onChange={e => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  placeholder="Area code (optional, e.g. 415)"
                  className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-400" />
                <button type="button" onClick={buyNumber} disabled={buying}
                  className="px-4 py-2 rounded-lg bg-white text-black text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50 whitespace-nowrap">
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
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500">
              <option value="">Select a phone number…</option>
              {phoneNumbers.map(p => (
                <option key={p.id} value={p.id}>
                  {p.number ?? p.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-zinc-500">No numbers yet. Click <span className="text-blue-400">+ Get a number</span> to provision one.</p>
          )}
        </div>

        {/* ── Voice selection ── */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-zinc-200">Voice</p>
            <button type="button" onClick={() => setShowVoicePicker(!showVoicePicker)}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
              {showVoicePicker ? 'Close' : 'Browse voices'}
            </button>
          </div>

          {/* Current selection */}
          {!showVoicePicker && (
            <div className="flex items-center gap-3 bg-zinc-900 rounded-lg px-4 py-3">
              <button type="button"
                onClick={() => playPreview(config.voiceId, selectedVoice?.preview_url || null)}
                className="w-9 h-9 rounded-full bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-white transition-colors flex-shrink-0">
                {playingId === config.voiceId ? '⏸' : '▶'}
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-200 font-medium">{config.voiceName || config.voiceId.slice(0, 12)}</p>
                {selectedVoice && (
                  <p className="text-xs text-zinc-500">
                    {[selectedVoice.labels?.gender, selectedVoice.labels?.accent, selectedVoice.labels?.age?.replace('_', ' ')].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => setShowVoicePicker(true)}
                className="text-xs text-zinc-500 hover:text-white transition-colors">Change</button>
            </div>
          )}

          {/* Voice picker */}
          {showVoicePicker && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input type="text" value={voiceSearch}
                  onChange={e => { setVoiceSearch(e.target.value); if (e.target.value.length >= 2) searchVoices(e.target.value) }}
                  placeholder="Search by name, accent, style…"
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
                <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
                  {(['all', 'female', 'male'] as const).map(f => (
                    <button key={f} type="button" onClick={() => setVoiceFilter(f)}
                      className={`px-3 py-2 text-xs capitalize transition-colors ${voiceFilter === f ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
                {filteredVoices.map(v => (
                  <div key={v.voice_id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                      config.voiceId === v.voice_id ? 'bg-zinc-700 border border-zinc-600' : 'hover:bg-zinc-900 border border-transparent'
                    }`}
                    onClick={() => selectVoice(v)}>
                    <button type="button"
                      onClick={e => { e.stopPropagation(); playPreview(v.voice_id, v.preview_url) }}
                      className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-600 flex items-center justify-center text-white text-xs flex-shrink-0 transition-colors">
                      {playingId === v.voice_id ? '⏸' : '▶'}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-zinc-200">{v.name}</p>
                      <p className="text-xs text-zinc-500 truncate">
                        {[v.labels?.gender, v.labels?.accent, v.labels?.age?.replace('_', ' '), v.labels?.use_case?.replace('_', ' ')].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {config.voiceId === v.voice_id && <span className="text-emerald-400 text-xs">Selected</span>}
                  </div>
                ))}
                {filteredVoices.length === 0 && <p className="text-xs text-zinc-500 text-center py-4">No voices match your search.</p>}
              </div>
            </div>
          )}
        </div>

        {/* ── Voice tuning ── */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 space-y-4">
          <p className="text-sm font-medium text-zinc-200">Voice Tuning</p>
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

        {/* ── Messages ── */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 space-y-4">
          <p className="text-sm font-medium text-zinc-200">Call Messages</p>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Opening Message</label>
            <textarea value={config.firstMessage || ''}
              onChange={e => setConfig(c => ({ ...c, firstMessage: e.target.value }))}
              placeholder="Hi there! How can I help you today?"
              rows={2}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none" />
            <p className="text-xs text-zinc-600 mt-1">First thing the agent says when the call connects.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Closing Message</label>
            <input type="text" value={config.endCallMessage || ''}
              onChange={e => setConfig(c => ({ ...c, endCallMessage: e.target.value }))}
              placeholder="Thanks for calling. Have a great day!"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
          </div>
        </div>

        {/* ── Call Settings ── */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 space-y-4">
          <p className="text-sm font-medium text-zinc-200">Call Settings</p>

          {/* Max duration */}
          <SliderField label="Max Call Duration" desc="" value={config.maxDurationSecs}
            onChange={v => setConfig(c => ({ ...c, maxDurationSecs: v }))} min={60} max={1800} step={60}
            format={v => `${Math.floor(v / 60)} min`} />

          {/* Language */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Language</label>
            <select value={config.language || ''}
              onChange={e => setConfig(c => ({ ...c, language: e.target.value || null }))}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500">
              {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
          </div>

          {/* Background sound */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Background Sound</label>
            <select value={config.backgroundSound || ''}
              onChange={e => setConfig(c => ({ ...c, backgroundSound: e.target.value || null }))}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500">
              {BACKGROUND_SOUNDS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          {/* Record calls toggle */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-300">Record Calls</p>
              <p className="text-xs text-zinc-600 mt-0.5">Save audio recordings with transcripts</p>
            </div>
            <button type="button" onClick={() => setConfig(c => ({ ...c, recordCalls: !c.recordCalls }))}
              className={`relative inline-flex h-6 w-11 rounded-full border-2 border-transparent transition-colors ${config.recordCalls ? 'bg-emerald-500' : 'bg-zinc-700'}`}>
              <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${config.recordCalls ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* End call phrases */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">End Call Phrases</label>
            <p className="text-xs text-zinc-600 mb-2">If the caller says one of these, the agent will end the call.</p>
            {config.endCallPhrases.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {config.endCallPhrases.map((p, i) => (
                  <span key={i} className="flex items-center gap-1 bg-zinc-800 text-zinc-300 text-xs rounded-full px-2.5 py-1">
                    {p}
                    <button type="button" onClick={() => setConfig(c => ({
                      ...c, endCallPhrases: c.endCallPhrases.filter((_, idx) => idx !== i)
                    }))} className="text-zinc-500 hover:text-red-400 ml-0.5">×</button>
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
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
              <button type="button" disabled={!newPhrase.trim()}
                onClick={() => {
                  if (newPhrase.trim()) {
                    setConfig(c => ({ ...c, endCallPhrases: [...c.endCallPhrases, newPhrase.trim()] }))
                    setNewPhrase('')
                  }
                }}
                className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors disabled:opacity-50">Add</button>
            </div>
          </div>
        </div>

        {/* ── Voice Tools ── */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 space-y-3">
          <div>
            <p className="text-sm font-medium text-zinc-200">Voice Tools</p>
            <p className="text-xs text-zinc-500 mt-0.5">
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
              <div key={tool.name} className="flex items-center gap-3 px-3 py-2 bg-zinc-900 rounded-lg">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                <span className="text-xs text-zinc-300 font-mono">{tool.name}</span>
                <span className="text-xs text-zinc-600 ml-auto">{tool.desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Webhook info ── */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-5 py-4">
          <p className="text-xs font-medium text-zinc-400 mb-1">Inbound Webhook</p>
          <code className="text-xs text-zinc-400 bg-zinc-900 px-2 py-1 rounded block">{typeof window !== 'undefined' ? window.location.origin : 'https://voxilityai.vercel.app'}/api/vapi/webhook</code>
          <p className="text-xs text-zinc-600 mt-2">Configured automatically for numbers provisioned above.</p>
        </div>

        <button type="submit" disabled={saving || !vapiReady}
          className="w-full inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 hover:bg-zinc-200 transition-colors disabled:opacity-50">
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Voice Settings'}
        </button>
      </form>

      {/* ── Test Call Panel (outside form) ── */}
      {vapiReady && vapiPublicKey && (
        <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-200">Test Call</p>
              <p className="text-xs text-zinc-500 mt-0.5">Talk to your voice agent live in the browser. Uses your microphone.</p>
            </div>
            {!testCallActive && !testCallConnecting ? (
              <button type="button" onClick={startTestCall}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-white" />
                Start call
              </button>
            ) : (
              <button type="button" onClick={stopTestCall}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
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
                    <div key={i} className={`w-1 rounded-full transition-all duration-75 ${
                      i / 12 < testVolume ? 'bg-emerald-400' : 'bg-zinc-800'
                    }`} style={{ height: `${8 + (i * 1.5)}px` }} />
                  ))}
                </div>
                <span className="text-xs text-zinc-500">
                  {testCallConnecting ? 'Connecting…' : testCallActive ? 'Connected' : ''}
                </span>
              </div>
            </div>
          )}

          {/* Live transcript */}
          {testTranscript.length > 0 && (
            <div ref={transcriptRef} className="max-h-64 overflow-y-auto space-y-2 bg-zinc-900 rounded-lg p-3">
              {testTranscript.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-blue-600/20 text-blue-200 border border-blue-800/30'
                      : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                  }`}>
                    <p className="text-xs text-zinc-500 mb-0.5">{msg.role === 'user' ? 'You' : agentName}</p>
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!testCallActive && !testCallConnecting && testTranscript.length === 0 && (
            <div className="text-center py-6">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-zinc-900 flex items-center justify-center">
                <svg className="w-5 h-5 text-zinc-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
              </div>
              <p className="text-xs text-zinc-500">Click Start call to test your agent. You'll need to allow microphone access.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
