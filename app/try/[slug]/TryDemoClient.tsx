'use client'

/**
 * The prospect-facing demo page. Three phases:
 *  1. building — poll /status every 2.5s; the first poll triggers lazy
 *     provisioning server-side. Honest staged copy driven by real
 *     ingestion progress.
 *  2. ready — big call button (mic → Gemini Live) + countdown.
 *  3. done/expired — dual CTA: claim → checkout, or vertical learn-more.
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

type Phase = 'building' | 'ready' | 'failed' | 'gone'

const POLL_MS = 2500
const MAX_POLL_MS = 3 * 60_000 // stop polling after 3 minutes and show failed state

export default function TryDemoClient({
  slug, businessName, websiteDomain, initialStatus, learnMoreHref,
}: {
  slug: string
  businessName: string
  websiteDomain: string
  initialStatus: string
  learnMoreHref: string
}) {
  const [phase, setPhase] = useState<Phase>(
    initialStatus === 'ready' ? 'ready'
    : initialStatus === 'failed' ? 'failed'
    : ['expired', 'claimed'].includes(initialStatus) ? 'gone'
    : 'building',
  )
  const [buildStep, setBuildStep] = useState(0)
  const [hasCalled, setHasCalled] = useState(false)
  // Set inside the polling effect (not here) — calling Date.now() during
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

  // Status polling while building.
  useEffect(() => {
    if (phase !== 'building') return
    pollStartRef.current = Date.now()
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        const res = await fetch(`/api/public/try/${slug}/status`)
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (data.status === 'ready') { setPhase('ready'); return }
        if (data.status === 'failed') { setPhase('failed'); return }
        if (['expired', 'claimed'].includes(data.status)) { setPhase('gone'); return }
        // Advance the visible step from real signals: run queued → 1,
        // running → 2, chunks landing → 3.
        const ing = data.ingestion
        setBuildStep(ing?.chunksCreated > 0 ? 3 : ing?.status === 'running' ? 2 : 1)
      } catch { /* transient — keep polling */ }
      if (pollStartRef.current !== null && Date.now() - pollStartRef.current > MAX_POLL_MS) { setPhase('failed'); return }
      if (!cancelled) timer = setTimeout(tick, POLL_MS)
    }
    timer = setTimeout(tick, 0)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [phase, slug])

  const claimHref = `/try/${slug}/claim`
  const live = state === 'live' || state === 'connecting'

  const stop = useCallback(() => { void endCall('ended') }, [endCall])

  return (
    <main className="min-h-screen bg-black text-zinc-100 flex flex-col">
      <div className="mx-auto w-full max-w-2xl px-6 py-16 flex-1 flex flex-col items-center justify-center text-center gap-8">

        {phase === 'building' && (
          <>
            <h1 className="text-3xl font-semibold">Building {businessName}&rsquo;s AI receptionist…</h1>
            <ol className="space-y-3 text-left text-zinc-400">
              {[
                `Reading ${websiteDomain}`,
                'Learning your services and hours',
                'Training your receptionist',
              ].map((label, i) => (
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
            <p className="text-zinc-400 max-w-md">
              Tap the button and ask it anything a caller would — your hours, your services, your prices. It learned them from {websiteDomain}.
            </p>

            {state === 'error' && error && <p className="text-accent-red text-sm">{error}</p>}

            {!live ? (
              <button
                onClick={() => void startCall()}
                className="rounded-full px-10 py-5 text-lg font-semibold shadow-lg hover:opacity-90 transition"
                style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
              >
                📞 Answer a call at {businessName}
              </button>
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
              <div className="mt-4 flex flex-col sm:flex-row gap-3">
                <a
                  href={claimHref}
                  className="rounded-lg px-6 py-3 font-semibold hover:opacity-90 transition"
                  style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
                >
                  Get this for {businessName}
                </a>
                <a href={learnMoreHref} className="rounded-lg border border-zinc-700 px-6 py-3 font-semibold text-zinc-100 hover:bg-zinc-900 transition">
                  Learn more
                </a>
              </div>
            )}
          </>
        )}

        {phase === 'failed' && (
          <>
            <h1 className="text-3xl font-semibold">We couldn&rsquo;t finish building this demo</h1>
            <p className="text-zinc-400 max-w-md">
              No drama — we can still show you exactly what an AI receptionist would do for {businessName}.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <a
                href={claimHref}
                className="rounded-lg px-6 py-3 font-semibold hover:opacity-90 transition"
                style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
              >
                Get this for {businessName}
              </a>
              <a href={learnMoreHref} className="rounded-lg border border-zinc-700 px-6 py-3 font-semibold text-zinc-100 hover:bg-zinc-900 transition">
                Learn more
              </a>
            </div>
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
                href={claimHref}
                className="rounded-lg px-6 py-3 font-semibold hover:opacity-90 transition"
                style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
              >
                Get this for {businessName}
              </a>
              <a href={learnMoreHref} className="rounded-lg border border-zinc-700 px-6 py-3 font-semibold text-zinc-100 hover:bg-zinc-900 transition">
                Learn more
              </a>
            </div>
          </>
        )}
      </div>

      <footer className="py-6 text-center text-xs text-zinc-600">
        A demo built by <Link href="/" className="underline">Xovera</Link>. Not affiliated with or endorsed by {businessName}.
      </footer>
    </main>
  )
}
