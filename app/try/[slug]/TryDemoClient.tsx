'use client'

/**
 * The prospect-facing demo page. Four phases:
 *  1. train — hero with a primary "Answer the call" action (POST .../train
 *     with { answerNow: true } — no website required, agent+voice get
 *     created with knowledge skipped) plus a visually secondary training
 *     block: a website input (prefilled from registration, editable) +
 *     "Build My AI" button. Nothing is provisioned until one of these is
 *     clicked — answering is the fast path, training is optional
 *     enrichment.
 *  2. training — real progress driven by polling /status every 2.5s:
 *     a staged list (reading → training on N pages → learning your
 *     services) built from the live IngestionRun row. 3-minute client
 *     timeout treats the run as terminal so a visitor is never stuck.
 *  3. ready — call UI (mic → Gemini Live) + dual CTA once a call has
 *     happened. If the crawl landed zero chunks, an honest note says so
 *     up front — the call is still allowed (the token route's own
 *     guardrail keeps the model from inventing facts).
 *  4. gone — expired/claimed: CTA-only hero, unchanged behavior.
 *
 * On mount we poll /status ONCE to decide the initial phase: already
 * ready with real content → straight to the call UI (returning
 * visitor); ready/provisioning with a live (queued/running) ingestion
 * run → resume the training view; anything else (including a prior
 * empty-chunks result, since that run is terminal and there's nothing
 * live to resume) → the train screen, so "Build My AI" doubles as the
 * retry/retrain action.
 *
 * Layout: the visual design (Figma redesign, see components under
 * ./sections/) is a full marketing lander — nav, hero w/ incoming-call
 * phone mockup, features, demo-prompt chips, stats, process, testimonials,
 * final CTA, footer. This file owns all state/data-fetching and wires
 * three equivalent "start the call" entry points (phone Answer button,
 * "Hear the Demo First", any prompt chip) to one handler.
 *
 * Purchase: every "Get this for my business" CTA (Nav, Hero's post-call
 * row, GoneHero, FinalCta) funnels through `onOpenCheckout` below, which
 * either opens the in-modal PurchaseModal (checkoutMode 'embedded' —
 * requires NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, see page.tsx) or falls
 * back to the external checkoutHref link so a CTA never dead-ends before
 * Ryan sets that env. The post-call auto-open only fires in embedded mode
 * — there's no equivalent overlay to force open pre-env-setup, and
 * auto-navigating a visitor off the page on call-end would be a bad
 * (and blockable) surprise.
 *
 * Styling: data-theme="soft-light" pins the page to the light palette
 * (see app/page.tsx for the same pattern) so it renders consistently
 * regardless of the visitor's theme cookie — matches the Figma design's
 * cream/white aesthetic. Solid CTA buttons use `.btn-primary` (see
 * app/globals.css); cards use `.vox-card`; the error message uses
 * `text-accent-red`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Nav from './sections/Nav'
import Hero from './sections/Hero'
import Features from './sections/Features'
import Prompts from './sections/Prompts'
import Stats from './sections/Stats'
import Process from './sections/Process'
import Testimonials from './sections/Testimonials'
import FinalCta from './sections/FinalCta'
import Footer from './sections/Footer'
import PurchaseModal from './sections/purchase/PurchaseModal'
import { promptChipsForVertical } from './sections/prompt-chips'
import { usePublicVoiceCall } from '@/lib/voice/use-public-voice-call'

type Phase = 'train' | 'training' | 'ready' | 'gone'
type CheckoutMode = 'embedded' | 'external'

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

export default function TryDemoClient({
  slug, businessName, websiteUrl, websiteDomain, vertical, initialStatus, contactEmail, checkoutHref, checkoutMode, learnMoreHref,
}: {
  slug: string
  businessName: string
  websiteUrl: string
  websiteDomain: string
  vertical: string | null
  initialStatus: string
  contactEmail: string | null
  checkoutHref: string
  checkoutMode: CheckoutMode
  learnMoreHref: string
}) {
  const isGoneStatus = initialStatus === 'expired' || initialStatus === 'claimed'
  const [phase, setPhase] = useState<Phase | null>(isGoneStatus ? 'gone' : null)
  const [ingestion, setIngestion] = useState<Ingestion>(null)
  const [websiteInput, setWebsiteInput] = useState(websiteUrl)
  const [submitting, setSubmitting] = useState(false)
  const [trainError, setTrainError] = useState<string | null>(null)
  const [answering, setAnswering] = useState(false)
  const [answerError, setAnswerError] = useState<string | null>(null)
  const [urlChangeIgnored, setUrlChangeIgnored] = useState(false)
  const [hasCalled, setHasCalled] = useState(false)
  const promptChips = useMemo(() => promptChipsForVertical(vertical), [vertical])
  // Set inside the polling effects (not here) — calling Date.now() during
  // render trips the react-hooks purity rule (impure-function-in-render).
  const pollStartRef = useRef<number | null>(null)

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

  // Progress polling while training. The agent itself exists within a
  // couple of seconds (only the crawl takes a minute), so once the server
  // reports status 'ready' the impatient path — "talk to it now" — is
  // legitimate; it just answers from whatever has landed so far.
  const [canCallEarly, setCanCallEarly] = useState(false)
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
        if (data.status === 'ready') setCanCallEarly(true)
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

  // Primary CTA: answer the call right now, no website required. POSTs
  // answerNow, which skips knowledge entirely (agent + voice config only)
  // and finalizes the prospect to ready — then we jump straight to the
  // ready phase and place the call.
  const handleAnswerNow = useCallback(async () => {
    setAnswering(true)
    setAnswerError(null)
    try {
      const res = await fetch(`/api/public/try/${slug}/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answerNow: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 410 || data.status === 'expired' || data.status === 'claimed') { setPhase('gone'); return }
      if (!res.ok || data.status !== 'ready') {
        setAnswerError(data?.message || 'Something went wrong — try again.')
        return
      }
      setIngestion(null) // nothing crawled yet — drives the softer ready-phase copy
      setPhase('ready')
      void startCall()
    } catch {
      setAnswerError('Something went wrong — try again.')
    } finally {
      setAnswering(false)
    }
  }, [slug, startCall])

  // Unified "start the call" handler — wired to the phone's Answer
  // button, "Hear the Demo First", and every demo-prompt chip. Behavior
  // depends on where provisioning currently stands.
  const handlePrimaryCallAction = useCallback(() => {
    if (phase === 'ready') { void startCall(); return }
    if (phase === 'train') { void handleAnswerNow(); return }
    if (phase === 'training' && canCallEarly) { setPhase('ready'); void startCall(); return }
    // training-but-not-ready-yet or gone: no-op, the UI already disables these triggers
  }, [phase, canCallEarly, startCall, handleAnswerNow])

  const live = state === 'live' || state === 'connecting'
  const onCall = live || answering
  const connecting = state === 'connecting' || answering
  const chunksCreated = ingestion?.chunksCreated ?? 0
  const thinContent = chunksCreated === 0

  const stop = useCallback(() => { void endCall('ended') }, [endCall])

  // PurchaseModal: opens on the moment a call ends (the emotional peak,
  // step 0's hook card) in embedded mode, dismissible, reopenable from
  // every CTA. onOpenCheckout is the single entry point every CTA calls;
  // external mode just navigates instead of mounting the modal.
  const [purchaseModalOpen, setPurchaseModalOpen] = useState(false)
  const [purchaseInitialStep, setPurchaseInitialStep] = useState<0 | 1>(1)
  const modalShownRef = useRef(false)
  const onOpenCheckout = useCallback((initialStep: 0 | 1 = 1) => {
    if (checkoutMode !== 'embedded') {
      if (typeof window !== 'undefined') window.location.href = checkoutHref
      return
    }
    setPurchaseInitialStep(initialStep)
    setPurchaseModalOpen(true)
  }, [checkoutMode, checkoutHref])
  useEffect(() => {
    if (checkoutMode === 'embedded' && state === 'ended' && hasCalled && !modalShownRef.current) {
      modalShownRef.current = true
      onOpenCheckout(0)
    }
  }, [checkoutMode, state, hasCalled, onOpenCheckout])

  // Share: the person on the demo often isn't the decision maker. One
  // tap shares the trained demo link (native sheet on mobile, clipboard
  // on desktop).
  const [shareCopied, setShareCopied] = useState(false)
  const share = useCallback(async () => {
    const url = typeof window !== 'undefined' ? window.location.href : ''
    const text = `Listen to this — an AI receptionist trained on ${businessName}'s website. It answers like our front desk: ${url}`
    try {
      if (navigator.share) {
        await navigator.share({ title: `${businessName} — AI receptionist demo`, text, url })
        return
      }
    } catch { /* user dismissed the sheet — fall through to nothing */ }
    try {
      await navigator.clipboard.writeText(text)
      setShareCopied(true)
      setTimeout(() => setShareCopied(false), 2500)
    } catch { /* clipboard unavailable — nothing sensible left to do */ }
  }, [businessName])

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

  // Phone / chip status line + disabled state, shared across every
  // "start the call" trigger.
  const statusLabel = phase === 'training' ? (canCallEarly ? 'ready — tap answer' : 'training…') : 'ringing…'
  const primaryActionDisabled = phase === 'gone' || (phase === 'training' && !canCallEarly)
  const chipsDisabled = primaryActionDisabled || onCall

  const callError = state === 'error' ? error : null

  if (phase === null) {
    // Loading — avoid flashing the full layout before we know whether
    // the demo is expired/claimed.
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--background)' }}>
        <div className="h-2 w-2 rounded-full animate-pulse" style={{ background: 'var(--text-muted)' }} />
      </div>
    )
  }

  return (
    <div data-theme="soft-light" className="min-h-screen overflow-x-hidden" style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
      <Nav checkoutHref={checkoutHref} checkoutMode={checkoutMode} onOpenCheckout={() => onOpenCheckout(1)} />

      <Hero
        businessName={businessName}
        websiteDomain={websiteDomain}
        checkoutHref={checkoutHref}
        checkoutMode={checkoutMode}
        onOpenCheckout={onOpenCheckout}
        learnMoreHref={learnMoreHref}
        phase={phase}
        ingestion={ingestion}
        thinContent={thinContent}
        websiteInput={websiteInput}
        setWebsiteInput={setWebsiteInput}
        submitting={submitting}
        trainError={trainError}
        urlChangeIgnored={urlChangeIgnored}
        onTrain={() => void handleTrain()}
        trainingSteps={trainingSteps}
        buildStep={buildStep}
        canCallEarly={canCallEarly}
        onCall={onCall}
        connecting={connecting}
        secondsLeft={secondsLeft}
        statusLabel={statusLabel}
        answerDisabled={primaryActionDisabled}
        onAnswer={handlePrimaryCallAction}
        onHangup={stop}
        callError={callError}
        answerError={answerError}
        hasCalled={hasCalled}
        onShare={() => void share()}
        shareCopied={shareCopied}
      />

      {phase !== 'gone' && (
        <>
          <Features />
          <Prompts
            businessName={businessName}
            chips={promptChips}
            disabled={chipsDisabled}
            onPick={handlePrimaryCallAction}
          />
        </>
      )}

      <Stats />
      <Process />
      <Testimonials />
      <FinalCta checkoutHref={checkoutHref} checkoutMode={checkoutMode} onOpenCheckout={() => onOpenCheckout(1)} learnMoreHref={learnMoreHref} />
      <Footer businessName={businessName} onShare={() => void share()} shareCopied={shareCopied} />

      {purchaseModalOpen && (
        <PurchaseModal
          slug={slug}
          businessName={businessName}
          contactEmail={contactEmail}
          initialStep={purchaseInitialStep}
          onClose={() => setPurchaseModalOpen(false)}
          onShare={() => void share()}
          shareCopied={shareCopied}
          externalCheckoutHref={checkoutHref}
        />
      )}
    </div>
  )
}
