'use client'

import { useCallback, useState } from 'react'
import { Phone, Search } from 'lucide-react'
import type { PurchaseProjection } from '@/lib/demo-purchase/state'
import type { AvailableNumber } from '@/lib/leadconnector/agency-provisioning'

const AREA_CODE_RE = /^\d{2,4}$/

/**
 * PurchaseModal step 4 — pick a phone number. `onDone` always receives
 * whatever projection the number/route.ts POST settled on (purchased,
 * failed, or deferred) — StepDone decides what to show from that, this
 * component doesn't need to branch on the outcome itself.
 */
export default function StepPickNumber({
  slug,
  sessionId,
  onDone,
  onNotReady,
}: {
  slug: string
  sessionId: string
  onDone: (purchase: PurchaseProjection) => void
  onNotReady: () => void
}) {
  const [areaCode, setAreaCode] = useState('')
  const [numbers, setNumbers] = useState<AvailableNumber[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [purchasing, setPurchasing] = useState<string | null>(null) // number being purchased, or 'skip'
  const [error, setError] = useState<string | null>(null)

  const postNumber = useCallback(async (body: { number?: string; skip?: boolean }) => {
    const res = await fetch(`/api/public/try/${slug}/purchase/number`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, ...body }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data?.purchase) {
      onDone(data.purchase as PurchaseProjection)
      return true
    }
    return false
  }, [slug, sessionId, onDone])

  const handleSearch = useCallback(async () => {
    if (!AREA_CODE_RE.test(areaCode.trim())) {
      setError('Enter a 2-4 digit area code.')
      return
    }
    setSearching(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/public/try/${slug}/purchase/numbers?areaCode=${encodeURIComponent(areaCode.trim())}&session_id=${encodeURIComponent(sessionId)}`,
      )
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}))
        if (data?.code === 'not_available') {
          // Adapter unconfigured/unreachable — never block a paid buyer.
          // Skip straight through so the pipeline reaches `complete` and
          // sends the magic link; StepDone shows the concierge copy.
          setPurchasing('skip')
          const ok = await postNumber({ skip: true })
          if (!ok) setError('Could not finish setup — our team has been notified and will email you.')
          setPurchasing(null)
          return
        }
        onNotReady()
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message || 'Could not search numbers right now — try again in a moment.')
        return
      }
      setNumbers(Array.isArray(data.numbers) ? data.numbers : [])
    } catch {
      setError('Could not search numbers right now — try again in a moment.')
    } finally {
      setSearching(false)
    }
  }, [areaCode, slug, sessionId, postNumber, onNotReady])

  const handlePick = useCallback(async (number: string) => {
    setPurchasing(number)
    setError(null)
    const ok = await postNumber({ number })
    if (!ok) setError('Could not purchase that number — try another, or have our team pick for you.')
    setPurchasing(null)
  }, [postNumber])

  const handleSkip = useCallback(async () => {
    setPurchasing('skip')
    setError(null)
    const ok = await postNumber({ skip: true })
    if (!ok) setError('Something went wrong — try again, or close this window; our team will follow up by email.')
    setPurchasing(null)
  }, [postNumber])

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold mb-1.5" style={{ color: 'var(--text-primary)' }}>
          Pick your business phone number
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Search by area code — this is the number your AI receptionist will answer.
        </p>
      </div>

      <div className="flex gap-2.5">
        <input
          type="text"
          inputMode="numeric"
          value={areaCode}
          onChange={e => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="e.g. 415"
          className="flex-1 min-w-0 rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2"
          style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }}
        />
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={searching || !areaCode.trim()}
          className="btn-primary px-5 shrink-0 disabled:opacity-50"
        >
          <Search className="h-4 w-4" />
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {error && <p className="text-sm text-accent-red">{error}</p>}

      {numbers && numbers.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No numbers found for that area code — try another.</p>
      )}

      {numbers && numbers.length > 0 && (
        <ul className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
          {numbers.map(n => (
            <li key={n.number}>
              <button
                type="button"
                onClick={() => void handlePick(n.number)}
                disabled={purchasing !== null}
                className="w-full flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors disabled:opacity-50"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)', color: 'var(--text-primary)' }}
              >
                <span className="flex items-center gap-2.5 font-semibold">
                  <Phone className="h-4 w-4 shrink-0" style={{ color: 'var(--accent-primary)' }} />
                  {n.formatted}
                </span>
                <span style={{ color: 'var(--text-tertiary)' }}>
                  {purchasing === n.number ? 'Purchasing…' : n.region || ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => void handleSkip()}
        disabled={purchasing !== null}
        className="text-sm text-center disabled:opacity-50"
        style={{ color: 'var(--text-tertiary)' }}
      >
        {purchasing === 'skip' ? 'One moment…' : "Have your team pick for me →"}
      </button>
    </div>
  )
}
