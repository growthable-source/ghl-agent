'use client'

import { useEffect, useState } from 'react'

interface AvailableNumber {
  phoneNumber: string
  friendlyName: string
  locality: string | null
  region: string | null
}

interface Props {
  workspaceId: string
  agentId: string
  /** Currently provisioned number (from GeminiVoiceConfig.twilioNumber). */
  currentNumber: string | null
  onProvisioned: (e164: string) => void
}

/**
 * Twilio number provisioning for a Gemini voice agent. Lives inside the
 * Gemini config section of the voice page (Plan 1). Styling uses the
 * remapped zinc scale + accent tokens only — never bg-white (orange).
 */
export function GeminiPhoneNumberPanel({ workspaceId, agentId, currentNumber, onProvisioned }: Props) {
  const [country, setCountry] = useState('US')
  const [areaCode, setAreaCode] = useState('')
  const [available, setAvailable] = useState<AvailableNumber[]>([])
  const [loading, setLoading] = useState(false)
  const [buying, setBuying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const base = `/api/workspaces/${workspaceId}/agents/${agentId}/gemini/phone-numbers`

  async function search() {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ countryCode: country })
      if (areaCode) qs.set('areaCode', areaCode)
      const res = await fetch(`${base}?${qs}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Search failed')
      setAvailable(data.available ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }

  async function buy(phoneNumber: string) {
    setBuying(phoneNumber)
    setError(null)
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, countryCode: country }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Purchase failed')
      onProvisioned(data.number.phoneNumber)
      setAvailable([])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Purchase failed')
    } finally {
      setBuying(null)
    }
  }

  useEffect(() => {
    setAvailable([])
  }, [country])

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
      <div className="text-sm font-medium text-zinc-100">Phone number</div>

      {currentNumber ? (
        <div className="text-sm text-zinc-300">
          This agent answers calls on{' '}
          <span className="font-mono text-accent-amber">{currentNumber}</span>.
        </div>
      ) : (
        <div className="text-sm text-zinc-400">
          No number yet. Search and buy one to let callers reach this agent.
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-zinc-400">
          Country
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="mt-1 block rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
          >
            <option value="US">United States</option>
            <option value="CA">Canada</option>
            <option value="GB">United Kingdom</option>
            <option value="AU">Australia</option>
          </select>
        </label>
        <label className="text-xs text-zinc-400">
          Area code (optional)
          <input
            value={areaCode}
            onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="415"
            className="mt-1 block w-24 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
          />
        </label>
        <button
          onClick={search}
          disabled={loading}
          className="rounded bg-accent-primary-bg px-3 py-1.5 text-sm text-zinc-100 disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search numbers'}
        </button>
      </div>

      {error && (
        <div className="rounded border border-accent-red-bg bg-accent-red-bg/20 px-3 py-2 text-sm text-accent-red">
          {error}
        </div>
      )}

      {available.length > 0 && (
        <ul className="divide-y divide-zinc-800 rounded border border-zinc-800">
          {available.map((n) => (
            <li key={n.phoneNumber} className="flex items-center justify-between px-3 py-2">
              <div>
                <div className="font-mono text-sm text-zinc-100">{n.phoneNumber}</div>
                <div className="text-xs text-zinc-400">
                  {[n.locality, n.region].filter(Boolean).join(', ') || n.friendlyName}
                </div>
              </div>
              <button
                onClick={() => buy(n.phoneNumber)}
                disabled={buying === n.phoneNumber}
                className="rounded bg-accent-primary-bg px-3 py-1 text-sm text-zinc-100 disabled:opacity-50"
              >
                {buying === n.phoneNumber ? 'Buying…' : 'Buy'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
