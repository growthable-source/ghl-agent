'use client'

/**
 * The prospect-facing demo page. Four phases:
 *  1. train — hero + a website input (prefilled from registration,
 *     editable) + "Train my AI receptionist" button. Nothing is
 *     provisioned until this button is clicked (POST .../train).
 *  2. training — real progress driven by polling /status every 2.5s:
 *     a staged list (reading → training on N pages → learning your
 *     services) built from the live IngestionRun row. 3-minute client
 *     timeout treats the run as terminal so a visitor is never stuck.
 *  3. ready — call UI (mic → Gemini Live) + dual CTA once a call has
 *     happened. If the crawl landed zero chunks, an honest note says so
 *     up front — the call is still allowed (the token route's own
 *     guardrail keeps the model from inventing facts).
 *  4. gone — expired/claimed: CTA-only page, unchanged from before.
 *
 * On mount we poll /status ONCE to decide the initial phase: already
 * ready with real content → straight to the call UI (returning
 * visitor); ready/provisioning with a live (queued/running) ingestion
 * run → resume the training view; anything else (including a prior
 * empty-chunks result, since that run is terminal and there's nothing
 * live to resume) → the train screen, so "Train my AI receptionist"
 * doubles as the retry/retrain action.
 *
 * Styling note: the plan draft referenced `bg-accent-primary-bg` /
 * `text-accent-primary-fg` / `text-accent-red-fg` utilities. Only the
 * `-bg` (tinted) and un-suffixed (solid) accent tokens exist in
 * `app/globals.css`'s `@theme` block — there is no `-fg` variant.
 * Solid CTA buttons here use the same pattern as the rest of the
 * dashboard/marketing pages: `bg-accent-primary` + inline
 * `color: var(--btn-primary-text)`. The build-step dot uses solid
 * `bg-accent-primary` (a `-bg` tint would be nearly invisible on the
 * black page background). The error message uses `text-accent-red`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePublicVoiceCall } from '@/lib/voice/use-public-voice-call'

type Phase = 'train' | 'training' | 'ready' | 'gone'

type Ingestion = {
  status: string
  chunksCreated: number
  pagesAttempted: number
  pagesSucceeded: number
} | null

const POLL_MS = 2500
const MAX_POLL_MS = 3 * 60_000 // stop polling after 3 minutes and unlock the call anyway
const LIVE_RUN_STATUSES = ['queued', 'running']
const TERMINAL_RUN_STATUSES = ['success', 'partial', 'failed']

/** Rotating "you could ask me…" examples on the train screen — the pitch
 *  for pressing the button. Vertical-aware with a generic fallback. */
const ASK_ME_EXAMPLES: Record<string, string[]> = {
  'med-spa': ['“What treatments do you offer?”', '“How much is a consultation?”', '“Can I book for Saturday?”'],
  gym: ['“What memberships do you have?”', '“When are your classes?”', '“Do you do free trials?”'],
  default: ['“What services do you have?”', '“What areas do you service?”', '“What’s your pricing?”'],
}

export default function TryDemoClient({
  slug, businessName, websiteUrl, websiteDomain, vertical, initialStatus, checkoutHref, learnMoreHref,
}: {
  slug: string
  businessName: string
  websiteUrl: string
  websiteDomain: string
  vertical: string | null
  initialStatus: string
  checkoutHref: string
  learnMoreHref: string
}) {
  const isGoneStatus = initialStatus === 'expired' || initialStatus === 'claimed'
  const [phase, setPhase] = useState<Phase | null>(isGoneStatus ? 'gone' : null)
  const [ingestion, setIngestion] = useState<Ingestion>(null)
  const [websiteInput, setWebsiteInput] = useState(websiteUrl)
  const [submitting, setSubmitting] = useState(false)
  const [trainError, setTrainError] = useState<string | null>(null)
  const [urlChangeIgnored, setUrlChangeIgnored] = useState(false)
  const [hasCalled, setHasCalled] = useState(false)
  // Rotating "you could ask me…" example on the train screen.
  const askExamples = ASK_ME_EXAMPLES[vertical ?? ''] ?? ASK_ME_EXAMPLES.default
  const [askIndex, setAskIndex] = useState(0)
  const [askVisible, setAskVisible] = useState(true)
  // Set inside the polling effects (not here) — calling Date.now() during
  // render trips the react-hooks purity rule (impure-function-in-render).
  const pollStartRef = useRef<number | null>(null)

  // Fade each example out, swap it, fade the next in. Only ticks while
  // the train screen is showing.
  useEffect(() => {
    if (phase !== 'train') return
    const interval = setInterval(() => {
      setAskVisible(false)
      setTimeout(() => {
        setAskIndex(i => (i + 1) % askExamples.length)
        setAskVisible(true)
      }, 350)
    }, 2800)
    return () => clearInterval(interval)
  }, [phase, askExamples.length])

  const { state, error, secondsLeft, startCall, endCall } = usePublicVoiceCall({
    tokenEndpoint: `/api/public/try/${slug}/web-token`,
    onEnded: ({ secsUsed, callId }) => {
      setHasCalled(true)
      if (callId) {
        // Best-effort beacon; sendBeacon survives tab close.
        const payload = JSON.stringify({ callId, secs: secsUsed })
        if (!navigator.sendBeacon?.(`/api/public/try/${slug}/call-end`, new Blob([payload], { type: 'application/json' }))) {
          void fetch(`/api/public/try/${slug}/call-end`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true,
          }).catch(() => {})
        }
      }
    },
  })

  // One-time initial-phase decision. Runs only while phase is still
  // unresolved (null) — the 'gone' short-circuit above skips it
  // entirely since expired/claimed is already known server-side.
  useEffect(() => {
    if (phase !== null) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/public/try/${slug}/status`)
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (data.status === 'expired' || data.status === 'claimed') { setPhase('gone'); return }
        const ing: Ingestion = data.ingestion ?? null
        setIngestion(ing)
        if (data.status === 'ready' && ing && ing.chunksCreated > 0) { setPhase('ready'); return }
        const hasLiveRun = !!ing && LIVE_RUN_STATUSES.includes(ing.status)
        if ((data.status === 'ready' || data.status === 'provisioning') && hasLiveRun) { setPhase('training'); return }
        setPhase('train')
      } catch {
        if (!cancelled) setPhase('train')
      }
    })()
    return () => { cancelled = true }
  }, [phase, slug])

  // Progress polling while training.
  useEffect(() => {
    if (phase !== 'training') return
    pollStartRef.current = Date.now()
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const res = await fetch(`/api/public/try/${slug}/status`)
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (data.status === 'expired' || data.status === 'claimed') { setPhase('gone'); return }
        if (data.status === 'failed') { setPhase('train'); return }
        const ing: Ingestion = data.ingestion ?? null
        setIngestion(ing)
        if (ing && TERMINAL_RUN_STATUSES.includes(ing.status)) { setPhase('ready'); return }
      } catch { /* transient — keep polling */ }
      if (pollStartRef.current !== null && Date.now() - pollStartRef.current > MAX_POLL_MS) { setPhase('ready'); return }
      if (!cancelled) timer = setTimeout(tick, POLL_MS)
    }
    timer = setTimeout(tick, 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [phase, slug])

  const handleTrain = useCallback(async () => {
    setSubmitting(true)
    setTrainError(null)
    try {
      const res = await fetch(`/api/public/try/${slug}/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ websiteUrl: websiteInput }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 410 || data.status === 'expired' || data.status === 'claimed') { setPhase('gone'); return }
      if (!res.ok) {
        setTrainError(data?.message || 'Something went wrong — try again.')
        return
      }
      if (data.urlChangeIgnored) setUrlChangeIgnored(true)
      setPhase('training')
    } catch {
      setTrainError('Something went wrong — try again.')
    } finally {
      setSubmitting(false)
    }
  }, [slug, websiteInput])

  const live = state === 'live' || state === 'connecting'
  const chunksCreated = ingestion?.chunksCreated ?? 0
  const thinContent = chunksCreated === 0

  const stop = useCallback(() => { void endCall('ended') }, [endCall])

  // Staged progress list — buildStep counts how many rows read as
  // "done"; the first not-yet-done row pulses. Labels/thresholds are
  // driven by the real IngestionRun row, not a fixed timer.
  const pagesSucceeded = ingestion?.pagesSucceeded ?? 0
  let buildStep = 1
  if (ingestion?.status === 'running' && pagesSucceeded > 0) buildStep = 2
  if (chunksCreated > 0) buildStep = 3
  const trainingSteps = [
    `Reading ${websiteDomain}…`,
    `Training on ${pagesSucceeded} page${pagesSucceeded === 1 ? '' : 's'} of ${businessName}’s site…`,
    'Learning your services…',
  ]

  return (
    <main className="min-h-screen bg-black text-zinc-100 flex flex-col">
      <div className="mx-auto w-full max-w-2xl px-6 py-16 flex-1 flex flex-col items-center justify-center text-center gap-8">

        {phase === null && (
          <div className="h-2 w-2 rounded-full bg-zinc-700 animate-pulse" />
        )}

        {phase === 'train' && (
          <>
            <p className="text-sm uppercase tracking-widest text-zinc-500">Live demo</p>
            <h1 className="text-3xl font-semibold">
              Meet {businessName}&rsquo;s AI receptionist
            </h1>
            <p className="text-zinc-400 max-w-md">
              We&rsquo;ll train it on your website in under a minute — then you can call it and hear it answer like your business would.
            </p>

            <div className="h-14 flex flex-col items-center justify-center" aria-live="polite">
              <p className="text-xs uppercase tracking-widest text-zinc-600">Some things you could ask it</p>
              <p
                className={`mt-1 text-lg text-zinc-200 transition-opacity duration-300 ${askVisible ? 'opacity-100' : 'opacity-0'}`}
              >
                {askExamples[askIndex]}
              </p>
            </div>

            <div className="w-full max-w-md flex flex-col gap-3">
              <input
                type="text"
                value={websiteInput}
                onChange={e => setWebsiteInput(e.target.value)}
                placeholder="yourwebsite.com"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-center text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-accent-primary"
              />
              {urlChangeIgnored && (
                <p className="text-xs text-zinc-500">This demo is already trained — the new website won&rsquo;t change it in this preview.</p>
              )}
              {trainError && <p className="text-accent-red text-sm">{trainError}</p>}
              <button
                onClick={() => void handleTrain()}
                disabled={submitting || !websiteInput.trim()}
                className="rounded-full px-10 py-5 text-lg font-semibold shadow-lg hover:opacity-90 transition disabled:opacity-50"
                style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
              >
                {submitting ? 'Starting…' : 'Train my AI receptionist'}
              </button>
            </div>
          </>
        )}

        {phase === 'training' && (
          <>
            <h1 className="text-3xl font-semibold">Training {businessName}&rsquo;s AI receptionist…</h1>
            <ol className="space-y-3 text-left text-zinc-400">
              {trainingSteps.map((label, i) => (
                <li key={label} className={`flex items-center gap-3 ${buildStep > i ? 'text-zinc-100' : ''}`}>
                  <span className={`inline-block h-2 w-2 rounded-full ${buildStep > i ? 'bg-accent-primary' : 'bg-zinc-700 animate-pulse'}`} />
                  {label}
                </li>
              ))}
            </ol>
            <p className="text-sm text-zinc-500">This usually takes under a minute — we&rsquo;re building it live from your website.</p>
          </>
        )}

        {phase === 'ready' && (
          <>
            <p className="text-sm uppercase tracking-widest text-zinc-500">Live demo</p>
            <h1 className="text-3xl font-semibold">
              This is what {businessName}&rsquo;s AI receptionist sounds like
            </h1>
            {thinContent ? (
              <div className="w-full max-w-md flex flex-col gap-3">
                <p className="text-zinc-400">
                  {ingestion?.status === 'failed'
                    ? `${websiteDomain} wouldn’t let us read it — some sites (and delivery platforms like UberEats) block robots. Your main website usually works best.`
                    : `We didn’t find much text on ${websiteDomain}. A different page of your site might work better.`}
                </p>
                <input
                  type="text"
                  value={websiteInput}
                  onChange={e => setWebsiteInput(e.target.value)}
                  placeholder="yourwebsite.com"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-center text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-accent-primary"
                />
                {trainError && <p className="text-accent-red text-sm">{trainError}</p>}
                <button
                  onClick={() => void handleTrain()}
                  disabled={submitting || !websiteInput.trim()}
                  className="rounded-lg border border-zinc-700 px-6 py-3 font-semibold text-zinc-100 hover:bg-zinc-900 transition disabled:opacity-50"
                >
                  {submitting ? 'Starting…' : 'Try a different website'}
                </button>
                <p className="text-xs text-zinc-500">Or call anyway — your receptionist will introduce itself and take a message instead of guessing at details.</p>
              </div>
            ) : (
              <p className="text-zinc-400 max-w-md">
                Tap the button and ask it anything a caller would — your hours, your services, your prices. It learned them from {websiteDomain}.
              </p>
            )}

            {state === 'error' && error && <p className="text-accent-red text-sm">{error}</p>}

            {!live ? (
              <div className="flex flex-col items-center gap-5">
                {/* Ringing phone: a shaking handset inside expanding ping
                    ripples — an incoming call the visitor's AI can take. */}
                <div className="relative h-24 w-24">
                  <span className="absolute inset-0 rounded-full bg-accent-primary opacity-20 animate-ping" />
                  <span className="absolute inset-2 rounded-full bg-accent-primary opacity-30 animate-ping" style={{ animationDelay: '400ms' }} />
                  <span className="absolute inset-0 flex items-center justify-center rounded-full bg-zinc-900 border border-zinc-800 text-4xl" style={{ animation: 'xv-ring 1.1s ease-in-out infinite' }}>
                    📞
                  </span>
                </div>
                <style>{`@keyframes xv-ring { 0%, 100% { transform: rotate(0deg); } 10% { transform: rotate(-14deg); } 20% { transform: rotate(12deg); } 30% { transform: rotate(-10deg); } 40% { transform: rotate(8deg); } 50% { transform: rotate(0deg); } }`}</style>
                <button
                  onClick={() => void startCall()}
                  className="rounded-full px-10 py-5 text-lg font-semibold shadow-lg hover:opacity-90 transition"
                  style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
                >
                  Your AI receptionist can answer this call for you!
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <div className="rounded-full border border-zinc-800 bg-zinc-900 px-8 py-4 text-lg">
                  {state === 'connecting' ? 'Connecting…' : `Live — ${secondsLeft ?? ''}s left`}
                </div>
                <button onClick={stop} className="text-sm text-zinc-400 underline hover:text-zinc-100">
                  End call
                </button>
              </div>
            )}

            {(hasCalled || state === 'ended') && (
              <div className="mt-4 flex flex-col items-center gap-3">
                <div className="flex flex-col sm:flex-row gap-3">
                  <a
                    href={checkoutHref}
                    className="rounded-lg px-6 py-3 font-semibold hover:opacity-90 transition"
                    style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
                  >
                    Get this for {businessName} — start today
                  </a>
                  <a href={learnMoreHref} className="rounded-lg border border-zinc-700 px-6 py-3 font-semibold text-zinc-100 hover:bg-zinc-900 transition">
                    Learn more
                  </a>
                </div>
                <p className="text-sm text-zinc-400 max-w-md">
                  You get: a Voice AI receptionist that works 24/7 + GoHighLevel Marketing &amp; Sales CRM bundle + free setup.
                </p>
              </div>
            )}
          </>
        )}

        {phase === 'gone' && (
          <>
            <h1 className="text-3xl font-semibold">This demo has wrapped up</h1>
            <p className="text-zinc-400 max-w-md">
              The live demo for {businessName} is no longer running — but getting the real thing takes minutes.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href={checkoutHref}
                className="rounded-lg px-6 py-3 font-semibold hover:opacity-90 transition"
                style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
              >
                Get this for {businessName} — start today
              </a>
              <a href={learnMoreHref} className="rounded-lg border border-zinc-700 px-6 py-3 font-semibold text-zinc-100 hover:bg-zinc-900 transition">
                Learn more
              </a>
            </div>
            <p className="text-sm text-zinc-400 max-w-md">
              You get: a Voice AI receptionist that works 24/7 + GoHighLevel Marketing &amp; Sales CRM bundle + free setup.
            </p>
          </>
        )}
      </div>

      <footer className="py-6 text-center text-xs text-zinc-600">
        A demo built by <Link href="/" className="underline">Xovera</Link>. Not affiliated with or endorsed by {businessName}.
      </footer>
    </main>
  )
}
