'use client'

/**
 * In-modal embedded-checkout purchase flow for /try/[slug]. Six steps:
 *
 *   0. Hook — the former ConversionModal's 🎉 "That was YOUR receptionist"
 *      card. Only reachable from the post-call CTA (TryDemoClient passes
 *      initialStep=0 there); every other entry point (Nav, FinalCta,
 *      GoneHero) starts at step 1 since there's no call to reference.
 *   1. StepDetails — name + email. Submitting mints a Stripe Embedded
 *      Checkout session (checkout-session/route.ts) and persists the
 *      email server-side as the abandoned-checkout remarketing hook
 *      regardless of whether the visitor ever pays.
 *   2. StepPayment — Embedded Checkout + order summary. Toggling
 *      monthly/annual re-mints a fresh clientSecret (a Checkout Session's
 *      clientSecret can't change after mount) and remounts the provider.
 *   3. StepProvisioning — polls the public status route until the
 *      server-side webhook pipeline reaches crm_ready (→ step 4) or a
 *      terminal state that skips number-picking entirely (→ step 5).
 *   4. StepPickNumber — area-code search + purchase, or skip to concierge.
 *   5. StepDone — check-your-email + (session-fresh only) number recap.
 *
 * Resume-on-reopen: sessionId (+ name/email/period, for re-minting a
 * checkout session if the visitor never finished paying) is mirrored into
 * localStorage keyed by slug. On mount, if a stored sessionId resolves
 * against the status route, the modal jumps straight to whatever step
 * that server-side state maps to — closing the modal (or reloading the
 * page) after payment never loses progress; the pipeline is entirely
 * server-driven from that point on.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { X } from 'lucide-react'
import type { PurchasePeriod, PurchaseProjection, PurchaseState } from '@/lib/demo-purchase/state'
import StepDetails from './StepDetails'
import StepPayment from './StepPayment'
import StepProvisioning from './StepProvisioning'
import StepPickNumber from './StepPickNumber'
import StepDone from './StepDone'

type Step = 0 | 1 | 2 | 3 | 4 | 5

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Module-level singleton per @stripe/react-stripe-js convention — loadStripe
// must only be called once per publishable key, not per render/mount.
let stripePromise: Promise<Stripe | null> | null = null
function getStripePromise(): Promise<Stripe | null> {
  if (!stripePromise) stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)
  return stripePromise
}

function storageKey(slug: string) {
  return `xovera:try:${slug}:purchase`
}
interface StoredPurchase {
  sessionId?: string
  name?: string
  email?: string
  period?: PurchasePeriod
  /** Stamped on every save — a resume entry older than RESUME_TTL_MS is
   *  treated as stale and dropped rather than resumed into. Guards
   *  against resuming a long-abandoned localStorage entry into a Stripe
   *  session that's since expired, or a purchase state that's moved on
   *  in ways the visitor never saw. */
  ts?: number
}
const RESUME_TTL_MS = 24 * 60 * 60 * 1000 // 24h

function loadStored(slug: string): StoredPurchase | null {
  try {
    const raw = localStorage.getItem(storageKey(slug))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredPurchase
    if (parsed.ts && Date.now() - parsed.ts > RESUME_TTL_MS) {
      clearStored(slug)
      return null
    }
    return parsed
  } catch { return null }
}
function saveStored(slug: string, patch: StoredPurchase) {
  try {
    const existing = loadStored(slug) || {}
    localStorage.setItem(storageKey(slug), JSON.stringify({ ...existing, ...patch, ts: Date.now() }))
  } catch { /* best-effort — private browsing / storage full */ }
}
function clearStored(slug: string) {
  try { localStorage.removeItem(storageKey(slug)) } catch { /* ignore */ }
}

function friendlyCheckoutError(status: number, code?: string): string {
  switch (code) {
    case 'already_purchased': return 'This demo has already been purchased.'
    case 'gone': return 'This demo link has expired.'
    case 'not_found': return "We couldn't find this demo."
    case 'rate_limited': return 'Too many attempts — try again in a few minutes.'
    case 'invalid_email': return 'Enter a valid email address.'
    case 'not_configured': return "Checkout isn't set up yet — try again shortly."
    default: return status >= 500 ? 'Something went wrong on our end — try again in a moment.' : 'Could not start checkout — try again.'
  }
}

async function mintCheckoutSession(
  slug: string,
  body: { name: string; email: string; period: PurchasePeriod },
): Promise<{ ok: true; clientSecret: string; sessionId: string } | { ok: false; message: string; code?: string }> {
  try {
    const res = await fetch(`/api/public/try/${slug}/purchase/checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data?.clientSecret && data?.sessionId) {
      return { ok: true, clientSecret: data.clientSecret, sessionId: data.sessionId }
    }
    return { ok: false, message: friendlyCheckoutError(res.status, data?.error), code: data?.error }
  } catch {
    return { ok: false, message: 'Something went wrong — try again.' }
  }
}

/** Where to resume the UI when a stored session resolves to live server
 *  state. Not a 1:1 mirror of PurchaseState — crm_failed/number_* are all
 *  terminal-for-the-buyer outcomes that land on the same "done" screen. */
function stepForResume(state: PurchaseState): Step {
  switch (state) {
    case 'checkout_started': return 2
    case 'paid':
    case 'account_ready':
    case 'claimed':
    case 'crm_provisioning':
    case 'number_purchasing': return 3
    case 'crm_ready': return 4
    default: return 5 // crm_failed, number_purchased, number_failed, number_deferred, complete
  }
}

export default function PurchaseModal({
  slug,
  businessName,
  contactEmail,
  initialStep,
  onClose,
  onShare,
  shareCopied,
  externalCheckoutHref,
}: {
  slug: string
  businessName: string
  contactEmail: string | null
  initialStep: 0 | 1
  onClose: () => void
  onShare: () => void
  shareCopied: boolean
  externalCheckoutHref: string
}) {
  const [step, setStep] = useState<Step>(initialStep)
  const [resolvingResume, setResolvingResume] = useState(true)
  const [name, setName] = useState('')
  const [email, setEmail] = useState(contactEmail || '')
  const [period, setPeriod] = useState<PurchasePeriod>('monthly')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [detailsSubmitting, setDetailsSubmitting] = useState(false)
  const [detailsError, setDetailsError] = useState<string | null>(null)
  const [changingPeriod, setChangingPeriod] = useState(false)
  const [periodChangeError, setPeriodChangeError] = useState<string | null>(null)
  const [finalPurchase, setFinalPurchase] = useState<PurchaseProjection | null>(null)
  const [showExitIntent, setShowExitIntent] = useState(false)
  const stripePromiseRef = useRef(getStripePromise())

  // Resume-on-mount: a stored sessionId from a prior open (this browser
  // session or a page reload) takes priority over `initialStep`.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const stored = loadStored(slug)
      if (stored?.sessionId) {
        try {
          const res = await fetch(`/api/public/try/${slug}/purchase/status?session_id=${encodeURIComponent(stored.sessionId)}`)
          if (res.ok) {
            const data = await res.json().catch(() => ({}))
            const p: PurchaseProjection | null = data?.purchase ?? null
            if (p && !cancelled) {
              const resolvedEmail = stored.email || contactEmail || ''
              const resolvedName = stored.name || ''
              const resolvedPeriod = p.period || stored.period || 'monthly'
              setName(resolvedName)
              setEmail(resolvedEmail)
              setPeriod(resolvedPeriod)
              const resumeStep = stepForResume(p.state)
              if (resumeStep === 2) {
                // Never paid — re-mint rather than trust a possibly-stale
                // stored/expired clientSecret.
                const minted = await mintCheckoutSession(slug, { name: resolvedName, email: resolvedEmail, period: resolvedPeriod })
                if (cancelled) return
                if (minted.ok) {
                  setClientSecret(minted.clientSecret)
                  setSessionId(minted.sessionId)
                  saveStored(slug, { sessionId: minted.sessionId })
                  setStep(2)
                } else {
                  clearStored(slug)
                  setStep(initialStep)
                }
              } else {
                setSessionId(stored.sessionId)
                setFinalPurchase(p)
                setStep(resumeStep)
              }
              setResolvingResume(false)
              return
            }
          }
          clearStored(slug) // stale/mismatched (404/403) — nothing to resume
        } catch { /* transient — fall through to a fresh entry */ }
      }
      if (!cancelled) setResolvingResume(false)
    })()
    return () => { cancelled = true }
    // Resume is a one-time mount decision — intentionally not re-run on prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  const handleDetailsSubmit = useCallback(async () => {
    setDetailsSubmitting(true)
    setDetailsError(null)
    const result = await mintCheckoutSession(slug, { name, email: email.trim(), period })
    setDetailsSubmitting(false)
    if (!result.ok) {
      setDetailsError(result.message)
      if (result.code === 'gone') clearStored(slug)
      return
    }
    setClientSecret(result.clientSecret)
    setSessionId(result.sessionId)
    saveStored(slug, { sessionId: result.sessionId, name, email: email.trim(), period })
    setStep(2)
  }, [slug, name, email, period])

  const handlePeriodChange = useCallback(async (next: PurchasePeriod) => {
    if (next === period || changingPeriod) return
    setChangingPeriod(true)
    setPeriodChangeError(null)
    const result = await mintCheckoutSession(slug, { name, email: email.trim(), period: next })
    setChangingPeriod(false)
    if (!result.ok) {
      setPeriodChangeError(result.message)
      if (result.code === 'gone') clearStored(slug)
      return
    }
    setPeriod(next)
    setClientSecret(result.clientSecret)
    setSessionId(result.sessionId)
    saveStored(slug, { sessionId: result.sessionId, period: next })
  }, [slug, name, email, period, changingPeriod])

  // Once the flow reaches the terminal "done" screen there's nothing left
  // to resume — clear the resume entry so a later /try/[slug] visit (or a
  // stale tab) can't re-resolve a finished purchase back into the modal.
  useEffect(() => {
    if (step === 5) clearStored(slug)
  }, [step, slug])

  const handlePaymentComplete = useCallback(() => setStep(3), [])
  const handleCrmReady = useCallback(() => setStep(4), [])
  const handleSkipToDone = useCallback((p: PurchaseProjection) => { setFinalPurchase(p); setStep(5) }, [])
  const handleNumberDone = useCallback((p: PurchaseProjection) => { setFinalPurchase(p); setStep(5) }, [])
  const handleNotReady = useCallback(() => setStep(3), [])

  const requestClose = useCallback(() => {
    if (step === 1 || step === 2) { setShowExitIntent(true); return }
    onClose()
  }, [step, onClose])

  const confirmExit = useCallback(() => {
    // Best-effort: if they were on the details step with a valid email
    // they never submitted, persist it anyway (same route the real
    // submit uses — it writes contactEmail + checkout_started regardless
    // of whether a Stripe session ever gets used).
    if (step === 1 && EMAIL_RE.test(email.trim())) {
      const payload = JSON.stringify({ name, email: email.trim(), period })
      const url = `/api/public/try/${slug}/purchase/checkout-session`
      const blob = new Blob([payload], { type: 'application/json' })
      if (!navigator.sendBeacon?.(url, blob)) {
        void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {})
      }
    }
    setShowExitIntent(false)
    onClose()
  }, [step, name, email, period, slug, onClose])

  const cancelExit = useCallback(() => setShowExitIntent(false), [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (showExitIntent) { cancelExit(); return }
      requestClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showExitIntent, cancelExit, requestClose])

  const maxWidth = step === 2 ? 'max-w-3xl' : step === 4 ? 'max-w-lg' : 'max-w-md'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 sm:px-6 py-6" role="dialog" aria-modal="true" aria-label="Get your AI receptionist">
      <button aria-label="Close" onClick={requestClose} className="absolute inset-0" style={{ background: 'rgba(28,25,23,0.6)' }} />

      <div
        className={`vox-card relative w-full ${maxWidth} max-h-[90vh] overflow-y-auto p-6 sm:p-8`}
        style={{ boxShadow: '0 20px 60px rgba(28,25,23,0.3)' }}
      >
        {!showExitIntent && (
          <button
            type="button"
            aria-label="Close"
            onClick={requestClose}
            className="absolute top-4 right-4 h-8 w-8 rounded-full flex items-center justify-center transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <X className="h-5 w-5" />
          </button>
        )}

        {showExitIntent ? (
          <div className="flex flex-col items-center text-center gap-4 py-4">
            <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Wait — don&rsquo;t lose your spot</h2>
            <p className="text-sm max-w-xs" style={{ color: 'var(--text-secondary)' }}>
              {step === 2
                ? "You're one step from your AI receptionist going live. Finish checkout and it's ready in minutes."
                : "You're seconds from getting started — want to keep going?"}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs mt-2">
              <button type="button" onClick={cancelExit} className="btn-primary flex-1 justify-center">Continue</button>
              <button type="button" onClick={confirmExit} className="btn-secondary flex-1 justify-center">Leave anyway</button>
            </div>
          </div>
        ) : resolvingResume ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-2 w-2 rounded-full animate-pulse" style={{ background: 'var(--text-muted)' }} />
          </div>
        ) : (
          <>
            {step >= 1 && step <= 4 && (
              <div className="flex items-center gap-1.5 mb-6">
                {[1, 2, 3, 4].map(n => (
                  <span
                    key={n}
                    className="h-1 flex-1 rounded-full"
                    style={{ background: step >= n ? 'var(--accent-primary)' : 'var(--surface-tertiary)' }}
                  />
                ))}
              </div>
            )}

            {step === 0 && (
              <div className="flex flex-col items-center text-center gap-4">
                <p className="text-3xl">🎉</p>
                <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>That was YOUR receptionist.</h2>
                <p style={{ color: 'var(--text-secondary)' }}>
                  Want it answering {businessName}&rsquo;s phone 24/7 — nights, weekends, every missed call?
                </p>
                <button type="button" onClick={() => setStep(1)} className="btn-primary w-full justify-center text-lg py-4">
                  Yes — I want this for my business
                </button>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  14-day money-back guarantee · Cancel anytime
                </p>
                <button type="button" onClick={onShare} className="btn-secondary w-full justify-center">
                  {shareCopied ? 'Link copied — send it over!' : 'Not your call to make? Share it with the decision maker'}
                </button>
                <button type="button" onClick={requestClose} className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                  Maybe later
                </button>
              </div>
            )}

            {step === 1 && (
              <StepDetails
                name={name}
                email={email}
                onNameChange={setName}
                onEmailChange={setEmail}
                onSubmit={() => void handleDetailsSubmit()}
                submitting={detailsSubmitting}
                error={detailsError}
                fallbackHref={detailsError ? externalCheckoutHref : null}
              />
            )}

            {step === 2 && clientSecret && sessionId && (
              <StepPayment
                stripePromise={stripePromiseRef.current}
                clientSecret={clientSecret}
                sessionId={sessionId}
                period={period}
                onPeriodChange={p => void handlePeriodChange(p)}
                onPeriodChangeError={periodChangeError}
                changingPeriod={changingPeriod}
                onComplete={handlePaymentComplete}
              />
            )}

            {step === 3 && sessionId && (
              <StepProvisioning slug={slug} sessionId={sessionId} onCrmReady={handleCrmReady} onSkipToDone={handleSkipToDone} />
            )}

            {step === 4 && sessionId && (
              <StepPickNumber slug={slug} sessionId={sessionId} onDone={handleNumberDone} onNotReady={handleNotReady} />
            )}

            {step === 5 && sessionId && (
              <StepDone
                slug={slug}
                sessionId={sessionId}
                businessName={businessName}
                phoneNumber={finalPurchase?.phoneNumber ?? null}
                concierge={Boolean(finalPurchase?.concierge)}
                onShare={onShare}
                shareCopied={shareCopied}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
