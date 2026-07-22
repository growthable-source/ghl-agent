import Image from 'next/image'
import PhoneMockup from './PhoneMockup'

type Phase = 'train' | 'training' | 'ready' | 'gone'

type Ingestion = {
  status: string
  chunksCreated: number
  pagesAttempted: number
  pagesSucceeded: number
} | null

const AVATARS = ['/try-demo/avatar-1.jpg', '/try-demo/avatar-3.jpg', '/try-demo/avatar-5.jpg', '/try-demo/avatar-8.jpg']

export interface HeroProps {
  businessName: string
  websiteDomain: string
  checkoutHref: string
  checkoutMode: 'embedded' | 'external'
  onOpenCheckout: (initialStep?: 0 | 1) => void
  learnMoreHref: string

  phase: Phase
  ingestion: Ingestion
  thinContent: boolean

  websiteInput: string
  setWebsiteInput: (v: string) => void
  submitting: boolean
  trainError: string | null
  urlChangeIgnored: boolean
  onTrain: () => void

  trainingSteps: string[]
  buildStep: number
  canCallEarly: boolean

  onCall: boolean
  connecting: boolean
  secondsLeft: number | null
  statusLabel: string
  answerDisabled: boolean
  onAnswer: () => void
  onHangup: () => void
  callError: string | null
  answerError: string | null

  hasCalled: boolean
  onShare: () => void
  shareCopied: boolean
}

function GoneHero({
  businessName,
  checkoutHref,
  checkoutMode,
  onOpenCheckout,
  learnMoreHref,
}: {
  businessName: string
  checkoutHref: string
  checkoutMode: 'embedded' | 'external'
  onOpenCheckout: (initialStep?: 0 | 1) => void
  learnMoreHref: string
}) {
  return (
    <section className="relative pt-16 pb-20 px-6 overflow-hidden">
      <div className="relative z-10 max-w-2xl mx-auto text-center">
        <span className="section-label inline-block mb-5">Demo wrapped up</span>
        <h1 className="font-black tracking-tight leading-[1.05] mb-5" style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', color: 'var(--text-primary)' }}>
          This live demo has wrapped up.
        </h1>
        <p className="mb-8 leading-[1.65]" style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>
          The demo for {businessName} is no longer running — but getting the real thing takes minutes.
        </p>
        <div className="vox-card p-8 md:p-10 text-left sm:text-center">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-5">
            {checkoutMode === 'embedded' ? (
              <button type="button" onClick={() => onOpenCheckout(1)} className="btn-primary w-full sm:w-auto justify-center">
                📞 Get My AI Receptionist →
              </button>
            ) : (
              <a href={checkoutHref} className="btn-primary w-full sm:w-auto justify-center">
                📞 Get My AI Receptionist →
              </a>
            )}
            <a href={learnMoreHref} className="btn-secondary w-full sm:w-auto justify-center">
              Learn more
            </a>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            14-day money-back guarantee · Cancel anytime
          </p>
        </div>
      </div>
    </section>
  )
}

export default function Hero(props: HeroProps) {
  const {
    businessName, websiteDomain, checkoutHref, checkoutMode, onOpenCheckout, learnMoreHref,
    phase, ingestion, thinContent,
    websiteInput, setWebsiteInput, submitting, trainError, urlChangeIgnored, onTrain,
    trainingSteps, buildStep, canCallEarly,
    onCall, connecting, secondsLeft, statusLabel, answerDisabled, onAnswer, onHangup, callError, answerError,
    hasCalled, onShare, shareCopied,
  } = props

  if (phase === 'gone') {
    return <GoneHero businessName={businessName} checkoutHref={checkoutHref} checkoutMode={checkoutMode} onOpenCheckout={onOpenCheckout} learnMoreHref={learnMoreHref} />
  }

  const alreadyTrained = phase === 'ready' && !thinContent

  return (
    <section className="relative pt-14 sm:pt-20 pb-16 sm:pb-24 px-6 overflow-hidden">
      {/* Atmospheric orbs, matching the Figma reference */}
      <div className="absolute -left-40 -top-32 w-[500px] h-[500px] rounded-full blur-[80px] pointer-events-none" style={{ background: 'rgba(232,68,37,0.14)' }} />
      <div className="absolute -right-40 top-40 w-[420px] h-[420px] rounded-full blur-[80px] pointer-events-none" style={{ background: 'rgba(249,95,6,0.12)' }} />

      <div className="relative z-10 max-w-[1280px] mx-auto flex flex-col lg:flex-row gap-12 lg:gap-14 items-center">
        {/* ═══ LEFT ═══ */}
        <div className="flex-1 min-w-0 w-full max-w-xl lg:max-w-none">
          <h1
            className="font-black tracking-tight leading-[1.05] mb-5"
            style={{ fontSize: 'clamp(2.25rem, 4.6vw, 3.6rem)', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}
          >
            {businessName}&rsquo;s phone,{' '}
            <span className="text-gradient">answered perfectly</span> every single time.
          </h1>
          <p className="mb-7 leading-[1.65] max-w-md" style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>
            Your new AI receptionist already knows <strong style={{ color: 'var(--text-primary)' }}>{businessName}</strong> —
            tap Answer to hear it in action, then train it on your own business in 60 seconds.
          </p>

          {/* Lead capture card */}
          <div id="try-website-input" className="vox-card p-6 mb-6 scroll-mt-24">
            {phase === 'training' ? (
              <>
                <p className="section-label mb-2">Training your ai receptionist</p>
                <h3 className="font-bold text-[17px] mb-4" style={{ color: 'var(--text-primary)' }}>
                  Building it live from {websiteDomain}…
                </h3>
                <ol className="space-y-2.5">
                  {trainingSteps.map((label, i) => {
                    const done = buildStep > i
                    const active = buildStep === i + 1
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
                <p className="mt-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {canCallEarly
                    ? "It's ready early — tap Answer to talk to it now, it keeps learning while you chat."
                    : 'Usually under a minute — building it live from your website.'}
                </p>
              </>
            ) : (
              <>
                <p className="section-label mb-2">
                  {alreadyTrained ? '✓ trained on your business' : 'try it on your business — free'}
                </p>
                <h3 className="font-bold text-[17px] mb-1" style={{ color: 'var(--text-primary)' }}>
                  {alreadyTrained ? `Trained on ${websiteDomain}` : 'Paste your website. Get your AI receptionist.'}
                </h3>
                <p className="text-[13px] mb-4" style={{ color: 'var(--text-tertiary)' }}>
                  {phase === 'ready' && ingestion?.status === 'failed'
                    ? `${websiteDomain} wouldn't let us read it — some sites block robots. Try your main website.`
                    : phase === 'ready' && thinContent && ingestion !== null
                      ? `We didn't find much text on ${websiteDomain}. A different page might work better.`
                      : alreadyTrained
                        ? 'Want to point it at a different site? Paste a new URL any time.'
                        : 'We scan your site and build a trained AI that knows your hours, services and tone. Takes about 45 seconds.'}
                </p>
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="text"
                    value={websiteInput}
                    onChange={e => setWebsiteInput(e.target.value)}
                    placeholder="https://yourbusiness.com"
                    className="flex-1 min-w-0 rounded-xl border px-4 py-3.5 text-sm focus:outline-none focus:ring-2"
                    style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }}
                  />
                  <button
                    type="button"
                    onClick={onTrain}
                    disabled={submitting || !websiteInput.trim()}
                    className="btn-primary justify-center px-6 py-3.5 shrink-0 disabled:opacity-50"
                  >
                    {submitting ? 'Starting…' : alreadyTrained ? 'Retrain →' : 'Build My AI →'}
                  </button>
                </div>
                {urlChangeIgnored && (
                  <p className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>This demo is already trained — the new website won&rsquo;t change it in this preview.</p>
                )}
                {trainError && <p className="mt-2 text-xs text-accent-red">{trainError}</p>}
                <p className="mt-3 text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
                  Free to try · No credit card · Live in under 2 minutes
                </p>
              </>
            )}
          </div>

          {/* Secondary CTA + proof */}
          <div className="flex flex-wrap items-center gap-4 mb-7">
            <button
              type="button"
              onClick={onAnswer}
              disabled={answerDisabled}
              className="btn-primary rounded-full py-3.5 px-8 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              📞 Hear the Demo First
            </button>
            <span className="hidden lg:inline-flex text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
              ↗ phone is on the right
            </span>
          </div>
          {(answerError || callError) && <p className="mb-4 -mt-3 text-sm text-accent-red">{answerError || callError}</p>}

          <div className="flex items-center">
            <div className="flex items-center">
              {AVATARS.map((src, i) => (
                <div
                  key={src}
                  className="relative rounded-full overflow-hidden shrink-0"
                  style={{ width: 30, height: 30, marginLeft: i === 0 ? 0 : -8, border: '2px solid var(--background)' }}
                >
                  <Image src={src} alt="" width={30} height={30} className="object-cover w-full h-full" />
                </div>
              ))}
            </div>
            <p className="pl-3 text-[13px]">
              <span className="font-bold" style={{ color: 'var(--text-primary)' }}>2,400+</span>{' '}
              <span style={{ color: 'var(--text-secondary)' }}>businesses never miss a call</span>
            </p>
          </div>

          {hasCalled && (
            <div className="flex flex-col sm:flex-row gap-3 mt-7 pt-7 border-t" style={{ borderColor: 'var(--border)' }}>
              {checkoutMode === 'embedded' ? (
                <button type="button" onClick={() => onOpenCheckout(0)} className="btn-primary">
                  Get this for {businessName} — start today
                </button>
              ) : (
                <a href={checkoutHref} className="btn-primary">
                  Get this for {businessName} — start today
                </a>
              )}
              <button type="button" onClick={onShare} className="btn-secondary">
                {shareCopied ? 'Link copied!' : 'Share this demo'}
              </button>
            </div>
          )}
        </div>

        {/* ═══ RIGHT: iPhone ═══ */}
        <div className="flex flex-col items-center gap-4 shrink-0">
          <PhoneMockup
            businessName={businessName}
            onCall={onCall}
            connecting={connecting}
            secondsLeft={secondsLeft}
            statusLabel={statusLabel}
            answerDisabled={answerDisabled}
            onAnswer={onAnswer}
            onHangup={onHangup}
          />
        </div>
      </div>
    </section>
  )
}
