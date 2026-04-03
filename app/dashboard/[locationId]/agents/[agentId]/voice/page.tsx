'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

const ELEVENLABS_VOICES = [
  { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah', gender: 'Female' },
  { id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam', gender: 'Male' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily', gender: 'Female' },
  { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', gender: 'Male' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', gender: 'Male' },
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'Female' },
]

interface VapiConfig {
  phoneNumberId: string | null
  phoneNumber: string | null
  voiceId: string
  firstMessage: string | null
  endCallMessage: string | null
  maxDurationSecs: number
  recordCalls: boolean
  isActive: boolean
}

interface PhoneNumber {
  id: string
  number: string
  name: string
}

export default function VoicePage() {
  const params = useParams()
  const locationId = params.locationId as string
  const agentId = params.agentId as string

  const [config, setConfig] = useState<VapiConfig>({
    phoneNumberId: null,
    phoneNumber: null,
    voiceId: 'EXAVITQu4vr4xnSDxMaL',
    firstMessage: '',
    endCallMessage: '',
    maxDurationSecs: 600,
    recordCalls: true,
    isActive: false,
  })
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [vapiReady, setVapiReady] = useState(false)

  // Phone number provisioning
  const [showBuyForm, setShowBuyForm] = useState(false)
  const [areaCode, setAreaCode] = useState('')
  const [buying, setBuying] = useState(false)
  const [buyError, setBuyError] = useState('')

  useEffect(() => {
    fetch(`/api/locations/${locationId}/agents/${agentId}/vapi`)
      .then(r => r.json())
      .then(({ config: cfg, phoneNumbers: phones, vapiReady: ready }: {
        config: VapiConfig | null
        phoneNumbers: PhoneNumber[] | null
        vapiReady: boolean
      }) => {
        if (cfg) setConfig(cfg)
        setPhoneNumbers(phones || [])
        setVapiReady(ready)
      })
      .finally(() => setLoading(false))
  }, [locationId, agentId])

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

  async function buyNumber(e: React.FormEvent) {
    e.preventDefault()
    setBuying(true)
    setBuyError('')
    try {
      const res = await fetch(`/api/locations/${locationId}/agents/${agentId}/vapi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ areaCode }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to provision number')
      const newPhone: PhoneNumber = data.phone
      setPhoneNumbers(prev => [...prev, newPhone])
      setConfig(c => ({ ...c, phoneNumberId: newPhone.id, phoneNumber: newPhone.number }))
      setShowBuyForm(false)
      setAreaCode('')
    } catch (err: any) {
      setBuyError(err.message)
    } finally {
      setBuying(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><p className="text-zinc-500 text-sm">Loading…</p></div>

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold mb-1">Voice</h1>
        <p className="text-zinc-400 text-sm">Configure this agent for inbound phone calls. Uses the same knowledge base and agent brain as SMS.</p>
      </div>

      {!vapiReady && (
        <div className="mb-6 rounded-xl border border-red-900 bg-red-950/30 p-4">
          <p className="text-sm text-red-400 font-medium">Voice AI is not enabled on this account.</p>
          <p className="text-xs text-red-700 mt-1">Contact support to enable voice calling.</p>
        </div>
      )}

      <form onSubmit={save} className="space-y-6">
        {/* Enable toggle */}
        <div className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950 px-5 py-4">
          <div>
            <p className="text-sm font-medium text-zinc-200">Enable Voice</p>
            <p className="text-xs text-zinc-500 mt-0.5">Agent will answer inbound calls on the configured number</p>
          </div>
          <button
            type="button"
            onClick={() => setConfig(c => ({ ...c, isActive: !c.isActive }))}
            disabled={!vapiReady}
            className={`relative inline-flex h-6 w-11 rounded-full border-2 border-transparent transition-colors disabled:opacity-40 ${config.isActive ? 'bg-emerald-500' : 'bg-zinc-700'}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${config.isActive ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {/* Phone number */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-zinc-400">Phone Number</label>
            {vapiReady && (
              <button
                type="button"
                onClick={() => { setShowBuyForm(!showBuyForm); setBuyError('') }}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                {showBuyForm ? 'Cancel' : '+ Get a number'}
              </button>
            )}
          </div>

          {showBuyForm && (
            <div className="mb-3 rounded-lg border border-zinc-700 bg-zinc-900 p-4">
              <p className="text-xs text-zinc-400 mb-3">Provision a new phone number. Enter an area code to get a local number.</p>
              <form onSubmit={buyNumber} className="flex gap-2">
                <input
                  type="text"
                  value={areaCode}
                  onChange={e => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  placeholder="Area code e.g. 415"
                  maxLength={3}
                  required
                  className="flex-1 bg-zinc-800 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-zinc-400"
                />
                <button
                  type="submit"
                  disabled={buying || areaCode.length < 3}
                  className="px-4 py-2 rounded-lg bg-white text-black text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50 whitespace-nowrap"
                >
                  {buying ? 'Provisioning…' : 'Get number'}
                </button>
              </form>
              {buyError && <p className="text-xs text-red-400 mt-2">{buyError}</p>}
            </div>
          )}

          {phoneNumbers.length === 0 ? (
            <p className="text-sm text-zinc-500">No phone numbers yet. Click <span className="text-blue-400">+ Get a number</span> above to provision one.</p>
          ) : (
            <select
              value={config.phoneNumberId || ''}
              onChange={e => setConfig(c => ({ ...c, phoneNumberId: e.target.value }))}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
            >
              <option value="">Select a phone number…</option>
              {phoneNumbers.map(p => (
                <option key={p.id} value={p.id}>{p.name || p.number}</option>
              ))}
            </select>
          )}
        </div>

        {/* Voice selection */}
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Voice</label>
          <div className="grid grid-cols-2 gap-2">
            {ELEVENLABS_VOICES.map(v => (
              <button
                key={v.id}
                type="button"
                onClick={() => setConfig(c => ({ ...c, voiceId: v.id }))}
                className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                  config.voiceId === v.id
                    ? 'border-zinc-500 bg-zinc-800 text-white'
                    : 'border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400'
                }`}
              >
                <div className="font-medium">{v.name}</div>
                <div className="text-xs text-zinc-600">{v.gender} · ElevenLabs</div>
              </button>
            ))}
          </div>
        </div>

        {/* First message */}
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Opening Message</label>
          <textarea
            value={config.firstMessage || ''}
            onChange={e => setConfig(c => ({ ...c, firstMessage: e.target.value }))}
            placeholder="Hi there! How can I help you today?"
            rows={2}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-none"
          />
          <p className="text-xs text-zinc-600 mt-1">First thing the agent says when the call connects.</p>
        </div>

        {/* End call message */}
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Closing Message</label>
          <input
            type="text"
            value={config.endCallMessage || ''}
            onChange={e => setConfig(c => ({ ...c, endCallMessage: e.target.value }))}
            placeholder="Thanks for calling. Have a great day!"
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
        </div>

        {/* Max duration */}
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Max Call Duration — {Math.floor(config.maxDurationSecs / 60)} min</label>
          <input
            type="range"
            min={60}
            max={1800}
            step={60}
            value={config.maxDurationSecs}
            onChange={e => setConfig(c => ({ ...c, maxDurationSecs: Number(e.target.value) }))}
            className="w-full accent-white"
          />
          <div className="flex justify-between text-xs text-zinc-600 mt-1">
            <span>1 min</span><span>30 min</span>
          </div>
        </div>

        {/* Record calls */}
        <div className="flex items-center justify-between rounded-xl border border-zinc-800 px-5 py-3">
          <div>
            <p className="text-sm text-zinc-300">Record Calls</p>
            <p className="text-xs text-zinc-600 mt-0.5">Save audio recordings with transcripts</p>
          </div>
          <button
            type="button"
            onClick={() => setConfig(c => ({ ...c, recordCalls: !c.recordCalls }))}
            className={`relative inline-flex h-6 w-11 rounded-full border-2 border-transparent transition-colors ${config.recordCalls ? 'bg-emerald-500' : 'bg-zinc-700'}`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${config.recordCalls ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {/* Webhook URL info */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-5 py-4">
          <p className="text-xs font-medium text-zinc-400 mb-1">Inbound Webhook</p>
          <code className="text-xs text-zinc-400 bg-zinc-900 px-2 py-1 rounded block">{process.env.NEXT_PUBLIC_APP_URL || 'https://voxilityai.vercel.app'}/api/vapi/webhook</code>
          <p className="text-xs text-zinc-600 mt-2">This is configured automatically for numbers provisioned above.</p>
        </div>

        <button
          type="submit"
          disabled={saving || !vapiReady}
          className="w-full inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 hover:bg-zinc-200 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Voice Settings'}
        </button>
      </form>
    </div>
  )
}
