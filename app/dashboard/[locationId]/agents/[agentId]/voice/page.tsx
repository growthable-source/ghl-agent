'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'

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

  useEffect(() => {
    Promise.all([
      fetch(`/api/locations/${locationId}/agents/${agentId}/vapi`)
        .then(r => r.json())
        .then(({ config: cfg, phoneNumbers: phones, vapiReady: ready }) => {
          if (cfg) setConfig(cfg)
          setPhoneNumbers(phones || [])
          setVapiReady(ready)
        }),
      fetch('/api/voices')
        .then(r => r.json())
        .then(({ voices: v }) => setVoices(v || []))
        .catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [locationId, agentId])

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
    await fetch(`/api/locations/${locationId}/agents/${agentId}/vapi`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...config, phoneNumber: phone?.number || null }),
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

  const filteredVoices = voices.filter(v => {
    if (voiceFilter === 'male') return v.labels?.gender === 'male'
    if (voiceFilter === 'female') return v.labels?.gender === 'female'
    return true
  })

  const selectedVoice = voices.find(v => v.voice_id === config.voiceId)

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-zinc-500 text-sm">Loading…</p></div>

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold mb-1">Voice</h1>
        <p className="text-zinc-400 text-sm">Configure inbound call handling. Same knowledge base and brain as SMS.</p>
      </div>

      {!vapiReady && (
        <div className="mb-6 rounded-xl border border-red-900 bg-red-950/30 p-4">
          <p className="text-sm text-red-400 font-medium">Voice AI is not enabled on this account.</p>
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
    </div>
  )
}
