'use client'

/**
 * Ticking countdown to the intro-offer deadline (80% off setup).
 *
 * The deadline is a server-derived ISO string (lib/demo-purchase/offer.ts,
 * anchored to the prospect's persisted first-view timestamp) — this
 * component only renders it. It never invents or extends a deadline, which
 * is what keeps the urgency honest across refreshes.
 *
 * Hydration: the first paint can't include live digits, because the server
 * and the browser compute "time remaining" a few hundred milliseconds
 * apart and React would flag the mismatch. We render the static offer copy
 * immediately and let the digits appear on mount — the layout is sized so
 * nothing shifts when they do.
 *
 * `onExpire` fires once, at the moment the clock reaches zero, so the
 * surrounding UI can drop back to full price without a reload. The server
 * is still the authority on what's actually charged; this just keeps the
 * screen from continuing to advertise an offer that's gone.
 */
import { useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'
import { countdownParts, INTRO_DISCOUNT_PCT } from '@/lib/demo-purchase/offer'

export default function OfferCountdown({
  deadline,
  onExpire,
  variant = 'card',
}: {
  deadline: string
  onExpire?: () => void
  variant?: 'card' | 'bar'
}) {
  const [msRemaining, setMsRemaining] = useState<number | null>(null)
  const firedExpire = useRef(false)

  useEffect(() => {
    const target = new Date(deadline).getTime()
    if (Number.isNaN(target)) return

    function tick() {
      const remaining = Math.max(0, target - Date.now())
      setMsRemaining(remaining)
      if (remaining === 0 && !firedExpire.current) {
        firedExpire.current = true
        onExpire?.()
      }
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
    // onExpire is intentionally excluded — callers pass inline closures, and
    // re-running this effect would restart the interval on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline])

  if (msRemaining === 0) return null

  const parts = msRemaining === null ? null : countdownParts(msRemaining)
  const isBar = variant === 'bar'

  const digits = (
    <span
      className="font-mono font-bold tabular-nums"
      style={{ color: isBar ? 'var(--btn-primary-text)' : 'var(--accent-red)' }}
      // Reserve the digits' width before they mount so the row doesn't
      // reflow on hydration.
      suppressHydrationWarning
    >
      {parts ? `${parts.hours}:${parts.minutes}:${parts.seconds}` : '--:--:--'}
    </span>
  )

  if (isBar) {
    return (
      <div
        className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
        style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
      >
        <span className="flex items-center gap-1.5 font-semibold">
          <Clock className="h-4 w-4 shrink-0" aria-hidden />
          Today only — {INTRO_DISCOUNT_PCT}% off your setup fee
        </span>
        <span className="flex items-center gap-1.5">
          <span className="opacity-80">Offer ends in</span>
          {digits}
        </span>
      </div>
    )
  }

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 border"
      style={{ borderColor: 'var(--accent-red)', background: 'var(--accent-red-bg)' }}
    >
      <span className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
        <Clock className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--accent-red)' }} aria-hidden />
        {INTRO_DISCOUNT_PCT}% off setup ends in
      </span>
      <span className="text-[15px]">{digits}</span>
    </div>
  )
}
