'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { PurchaseProjection, PurchaseState } from '@/lib/demo-purchase/state'

const POLL_MS = 2500
const TIMEOUT_MS = 90_000

const CHECKLIST = ['Confirming your payment…', 'Creating your account…', 'Setting up your workspace…', 'Connecting your phone system…']

/** Maps a live PurchaseState onto how many checklist rows read as "done."
 *  There's no single canonical ordering doc for this — crm_failed is a
 *  branch, not a step after crm_ready — so this is a presentational
 *  judgment call: once we're anywhere at/after crm_provisioning's
 *  outcome, the checklist reads as fully done and PurchaseModal is about
 *  to move the visitor to step 4 or 5 anyway. */
function phaseFor(state: PurchaseState | undefined): number {
  switch (state) {
    case 'checkout_started': return 0
    case 'paid':
    case 'account_ready': return 1
    case 'claimed': return 2
    case 'crm_provisioning': return 3
    default: return 4 // crm_ready, crm_failed, number_*, complete
  }
}

export default function StepProvisioning({
  slug,
  sessionId,
  onCrmReady,
  onSkipToDone,
}: {
  slug: string
  sessionId: string
  onCrmReady: () => void
  onSkipToDone: (purchase: PurchaseProjection) => void
}) {
  const [purchase, setPurchase] = useState<PurchaseProjection | null>(null)
  const [timedOut, setTimedOut] = useState(false)
  // Set inside the effect below, not here — calling Date.now() during
  // render trips the react-hooks purity rule (same pattern TryDemoClient's
  // pollStartRef already uses for the training-progress poll).
  const startRef = useRef<number | null>(null)
  const settledRef = useRef(false)

  useEffect(() => {
    startRef.current = Date.now()
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const tick = async () => {
      try {
        const res = await fetch(`/api/public/try/${slug}/purchase/status?session_id=${encodeURIComponent(sessionId)}`)
        if (res.ok) {
          const data = await res.json().catch(() => ({}))
          const p: PurchaseProjection | null = data?.purchase ?? null
          if (!cancelled && p) {
            setPurchase(p)
            if (!settledRef.current) {
              if (p.state === 'crm_ready') {
                settledRef.current = true
                onCrmReady()
                return
              }
              if (p.state === 'crm_failed' || p.state === 'complete' || p.state === 'number_purchased' || p.state === 'number_failed' || p.state === 'number_deferred') {
                settledRef.current = true
                onSkipToDone(p)
                return
              }
            }
          }
        }
      } catch { /* transient — keep polling */ }
      if (!cancelled && startRef.current !== null && Date.now() - startRef.current > TIMEOUT_MS) setTimedOut(true)
      if (!cancelled) timer = setTimeout(tick, POLL_MS)
    }
    timer = setTimeout(tick, 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [slug, sessionId, onCrmReady, onSkipToDone])

  const phase = phaseFor(purchase?.state)

  return (
    <div className="flex flex-col items-center text-center gap-6 py-6">
      <div className="h-14 w-14 rounded-full flex items-center justify-center" style={{ background: 'var(--accent-primary-bg)' }}>
        <Loader2 className="h-7 w-7 animate-spin" style={{ color: 'var(--accent-primary)' }} />
      </div>
      <div>
        <h2 className="text-xl font-bold mb-1.5" style={{ color: 'var(--text-primary)' }}>
          Creating your account…
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          This usually takes under a minute — don&rsquo;t close this window.
        </p>
      </div>

      {timedOut ? (
        <div className="vox-card p-5 max-w-sm text-left">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            This is taking longer than expected — but you&rsquo;re all set. Our team is finishing setup by hand and will
            email you the moment it&rsquo;s ready.
          </p>
          <button
            type="button"
            onClick={() => onSkipToDone(purchase ?? { state: 'complete', period: 'monthly', concierge: true, phoneNumber: null })}
            className="btn-secondary w-full justify-center mt-4"
          >
            Got it — I&rsquo;ll check my email
          </button>
        </div>
      ) : (
        <ol className="flex flex-col gap-2.5 w-full max-w-xs text-left">
          {CHECKLIST.map((label, i) => {
            const done = phase > i
            const active = phase === i
            return (
              <li key={label} className="flex items-center gap-3 text-sm" style={{ color: done ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                <span
                  className={`inline-block h-2 w-2 rounded-full shrink-0 ${active ? 'xv-dot' : ''}`}
                  style={{ background: done || active ? 'var(--accent-primary)' : 'var(--surface-tertiary)' }}
                />
                {label}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
