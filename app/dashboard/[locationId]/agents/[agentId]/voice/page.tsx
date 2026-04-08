'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface VoiceTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, { type: string; description: string }>
      required: string[]
    }
  }
  condition?: string
}

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
  voiceTools: VoiceTool[] | null
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
  const locationId = params.locationId as string
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
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Phone provisioning
  const [showBuyForm, setShowBuyForm] = useState(false)
  const [areaCode, setAreaCode] = useState('')
  const [buyCountry, setBuyCountry] = useState('US')
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

  // Voice tools state
  const [editingTool, setEditingTool] = useState<VoiceTool | null>(null)
  const [showToolForm, setShowToolForm] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`/api/locations/${locationId}/agents/${agentId}/vapi`)
        .then(r => r.json())
        .then(({ config: cfg, phoneNumbers: phones, vapiReady: ready, vapiPublicKey: pk, testSystemPrompt: sp, agentName: an, serverUrl: su }) => {
          if (cfg) setConfig({ ...cfg, voiceTools: cfg.voiceTools || null })
          setPhoneNumbers(phones || [])
          setVapiReady(ready)
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
  }, [locationId, agentId])

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
    await fetch(`/api/locations/${locationId}/agents/${agentId}/vapi`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function buyNumber() {
    if (!areaCode.trim() || buying) return
    setBuying(true)
    setBuyError('')
    try {
      const res = await fetch(`/api/locations/${locationId}/agents/${agentId}/vapi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ areaCode: areaCode.trim(), country: buyCountry }),
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

      await vapi.start({
        name: agentName,
        model: {
          provider: 'anthropic' as any,
          model: 'claude-sonnet-4-20250514' as any,
          messages: [{ role: 'system' as any, content: testSystemPrompt + '\n\n## VOICE CALL INSTRUCTIONS\nYou are on a live phone call. Speak naturally and conversationally. Keep responses SHORT — 1-3 sentences max.' }],
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
        server: { url: serverUrl },
      })
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

  // ── Voice tools handlers ──
  function addVoiceTool() {
    setEditingTool({
      type: 'function',
      function: {
        name: '',
        description: '',
        parameters: { type: 'object', properties: {}, required: [] },
      },
      condition: '',
    })
    setShowToolForm(true)
  }

  function editVoiceTool(idx: number) {
    const tools = config.voiceTools || []
    const t = tools[idx]
    setEditingTool({
      ...t,
      function: {
        ...t.function,
        parameters: {
          ...t.function.parameters,
          properties: { ...t.function.parameters.properties },
          required: [...t.function.parameters.required],
        },
      },
    })
    setShowToolForm(true)
  }

  function removeVoiceTool(idx: number) {
    const tools = [...(config.voiceTools || [])]
    tools.splice(idx, 1)
    setConfig(c => ({ ...c, voiceTools: tools.length > 0 ? tools : null }))
  }

  function saveVoiceTool(tool: VoiceTool) {
    const tools = [...(config.voiceTools || [])]
    const existingIdx = tools.findIndex(t => t.function.name === tool.function.name)
    if (existingIdx >= 0) {
      tools[existingIdx] = tool
    } else {
      tools.push(tool)
    }
    setConfig(c => ({ ...c, voiceTools: tools }))
    setShowToolForm(false)
    setEditingTool(null)
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
            href={`/dashboard/${locationId}/integrations`}
            className="inline-block text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            Go to Integrations →
          </Link>
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
              <p className="text-xs text-zinc-500">Provision a local phone number by country and area code.</p>
              <div className="flex gap-2">
                <select value={buyCountry} onChange={e => setBuyCountry(e.target.value)}
                  className="bg-zinc-800 border border-zinc-600 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-zinc-400">
                  <option value="US">US +1</option>
                  <option value="GB">UK +44</option>
                  <option value="CA">CA +1</option>
                  <option value="AU">AU +61</option>
                  <option value="DE">DE +49</option>
                  <option value="FR">FR +33</option>
                  <option value="ES">ES +34</option>
                  <option value="IT">IT +39</option>
                  <option value="NL">NL +31</option>
                  <option value="BR">BR +55</option>
                  <option value="MX">MX +52</option>
                  <option value="IN">IN +91</option>
                  <option value="JP">JP +81</option>
                  <option value="SG">SG +65</option>
                  <option value="NZ">NZ +64</option>
                  <option value="IE">IE +353</option>
                  <option value="SE">SE +46</option>
                  <option value="NO">NO +47</option>
                  <option value="DK">DK +45</option>
                  <option value="FI">FI +358</option>
                  <option value="PT">PT +351</option>
                  <option value="AT">AT +43</option>
                  <option value="CH">CH +41</option>
                  <option value="BE">BE +32</option>
                  <option value="PL">PL +48</option>
                  <option value="ZA">ZA +27</option>
                  <option value="PH">PH +63</option>
                  <option value="IL">IL +972</option>
                </select>
                <input type="text" value={areaCode}
                  onChange={e => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 5))}
                  placeholder="Area code"
                  className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-400" />
                <button type="button" onClick={buyNumber} disabled={buying || !areaCode.trim()}
                  className="px-4 py-2 rounded-lg bg-white text-black text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50 whitespace-nowrap">
                  {buying ? 'Provisioning…' : 'Get number'}
                </button>
              </div>
              {buyError && <p className="text-xs text-red-400 mt-2">{buyError}</p>}
            </div>
          )}
          {phoneNumbers.length > 0 ? (
            <select value={config.phoneNumberId || ''}
              onChange={e => setConfig(c => ({ ...c, phoneNumberId: e.target.value }))}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500">
              <option value="">Select a phone number…</option>
              {phoneNumbers.map(p => <option key={p.id} value={p.id}>{p.name || p.number}</option>)}
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
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-zinc-200">Voice Tools</p>
              <p className="text-xs text-zinc-500 mt-0.5">Custom functions the agent can call during a voice call.</p>
            </div>
            <button type="button" onClick={addVoiceTool}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors">+ Add tool</button>
          </div>

          {/* Built-in tools (read only) */}
          <div className="space-y-1.5">
            <p className="text-xs text-zinc-500 font-medium">Built-in</p>
            {['get_available_slots', 'book_appointment', 'tag_contact', 'send_sms_followup'].map(name => (
              <div key={name} className="flex items-center gap-2 px-3 py-2 bg-zinc-900 rounded-lg">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                <span className="text-xs text-zinc-300 font-mono">{name}</span>
                <span className="text-xs text-zinc-600 ml-auto">built-in</span>
              </div>
            ))}
          </div>

          {/* Custom tools */}
          {(config.voiceTools || []).length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-zinc-500 font-medium">Custom</p>
              {(config.voiceTools || []).map((tool, idx) => (
                <div key={idx} className="flex items-center gap-2 px-3 py-2 bg-zinc-900 rounded-lg group">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-zinc-300 font-mono">{tool.function.name || 'unnamed'}</span>
                    {tool.condition && (
                      <p className="text-xs text-zinc-600 truncate mt-0.5">When: {tool.condition}</p>
                    )}
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button type="button" onClick={() => editVoiceTool(idx)}
                      className="text-xs text-zinc-500 hover:text-white px-1.5 py-0.5 transition-colors">Edit</button>
                    <button type="button" onClick={() => removeVoiceTool(idx)}
                      className="text-xs text-zinc-500 hover:text-red-400 px-1.5 py-0.5 transition-colors">Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Tool form */}
          {showToolForm && editingTool && (
            <ToolForm
              tool={editingTool}
              onSave={saveVoiceTool}
              onCancel={() => { setShowToolForm(false); setEditingTool(null) }}
            />
          )}
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

// ─── Tool Form Component ─────────────────────────────────────────────────

function ToolForm({ tool, onSave, onCancel }: {
  tool: VoiceTool
  onSave: (t: VoiceTool) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(tool.function.name)
  const [description, setDescription] = useState(tool.function.description)
  const [condition, setCondition] = useState(tool.condition || '')
  const [params, setParams] = useState<{ key: string; type: string; desc: string; required: boolean }[]>(() => {
    const props = tool.function.parameters.properties
    const req = tool.function.parameters.required
    return Object.entries(props).map(([key, val]) => ({
      key,
      type: val.type,
      desc: val.description,
      required: req.includes(key),
    }))
  })
  const [newParamKey, setNewParamKey] = useState('')

  function addParam() {
    if (!newParamKey.trim()) return
    const key = newParamKey.trim().replace(/\s+/g, '_').toLowerCase()
    if (params.some(p => p.key === key)) return
    setParams(prev => [...prev, { key, type: 'string', desc: '', required: false }])
    setNewParamKey('')
  }

  function handleSave() {
    if (!name.trim()) return
    const properties: Record<string, { type: string; description: string }> = {}
    const required: string[] = []
    for (const p of params) {
      properties[p.key] = { type: p.type, description: p.desc }
      if (p.required) required.push(p.key)
    }
    onSave({
      type: 'function',
      function: {
        name: name.trim().replace(/\s+/g, '_').toLowerCase(),
        description: description.trim(),
        parameters: { type: 'object', properties, required },
      },
      ...(condition.trim() ? { condition: condition.trim() } : {}),
    })
  }

  return (
    <div className="border border-zinc-700 rounded-lg bg-zinc-900 p-4 space-y-3">
      <p className="text-xs font-medium text-zinc-300">
        {tool.function.name ? 'Edit Tool' : 'New Tool'}
      </p>

      <div>
        <label className="block text-xs text-zinc-500 mb-1">Function Name</label>
        <input type="text" value={name}
          onChange={e => setName(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
          placeholder="e.g. check_pricing"
          className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-400" />
      </div>

      <div>
        <label className="block text-xs text-zinc-500 mb-1">Description</label>
        <input type="text" value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="What does this tool do? The AI uses this to decide when to call it."
          className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-400" />
      </div>

      <div>
        <label className="block text-xs text-zinc-500 mb-1">Condition <span className="text-zinc-600">(optional)</span></label>
        <input type="text" value={condition}
          onChange={e => setCondition(e.target.value)}
          placeholder="e.g. Only use when the caller asks about pricing"
          className="w-full bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-400" />
        <p className="text-xs text-zinc-600 mt-1">Natural language condition. Added to the system prompt so the AI knows when to use this tool.</p>
      </div>

      {/* Parameters */}
      <div>
        <label className="block text-xs text-zinc-500 mb-1.5">Parameters</label>
        {params.length > 0 && (
          <div className="space-y-2 mb-2">
            {params.map((p, i) => (
              <div key={p.key} className="flex items-start gap-2 bg-zinc-800 rounded-lg p-2">
                <div className="flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-300 font-mono">{p.key}</span>
                    <select value={p.type}
                      onChange={e => setParams(prev => prev.map((pp, ii) => ii === i ? { ...pp, type: e.target.value } : pp))}
                      className="bg-zinc-700 border border-zinc-600 rounded px-1.5 py-0.5 text-xs text-zinc-300 focus:outline-none">
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                    </select>
                    <label className="flex items-center gap-1 text-xs text-zinc-500 ml-auto">
                      <input type="checkbox" checked={p.required}
                        onChange={e => setParams(prev => prev.map((pp, ii) => ii === i ? { ...pp, required: e.target.checked } : pp))}
                        className="rounded border-zinc-600 bg-zinc-800 text-emerald-500" />
                      required
                    </label>
                  </div>
                  <input type="text" value={p.desc}
                    onChange={e => setParams(prev => prev.map((pp, ii) => ii === i ? { ...pp, desc: e.target.value } : pp))}
                    placeholder="Description for this parameter"
                    className="w-full bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-400" />
                </div>
                <button type="button" onClick={() => setParams(prev => prev.filter((_, ii) => ii !== i))}
                  className="text-zinc-600 hover:text-red-400 text-xs p-1 transition-colors mt-0.5">x</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input type="text" value={newParamKey}
            onChange={e => setNewParamKey(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addParam() } }}
            placeholder="param_name"
            className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-2 py-1.5 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-400" />
          <button type="button" onClick={addParam} disabled={!newParamKey.trim()}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg transition-colors disabled:opacity-50">Add param</button>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button type="button" onClick={handleSave} disabled={!name.trim()}
          className="px-4 py-2 rounded-lg bg-white text-black text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50">
          Save tool
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}
