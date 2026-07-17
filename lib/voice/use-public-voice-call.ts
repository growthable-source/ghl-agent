'use client'

/**
 * Browser-side Gemini Live voice call for the PUBLIC landing-page demo.
 * Same audio pipeline as the dashboard tester (useGeminiTestCall) but it
 * fetches its token from the public, demo-agent endpoint and disables tool
 * calls + transcript persistence (both hit authed routes). Mic → Gemini
 * Live directly; no Twilio, no Fly bridge.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { GeminiLiveProvider } from '@/lib/copilot/providers/gemini-live'
import { MicCapture, PcmPlayer } from '@/lib/copilot/audio-client'

export type WebCallState = 'idle' | 'connecting' | 'live' | 'ended' | 'error' | 'unavailable'

export interface PublicVoiceCallOptions {
  /** Token mint endpoint. Default: the fixed homepage demo agent. */
  tokenEndpoint?: string
  /** Fired once per call on teardown with how long it ran. */
  onEnded?: (info: { secsUsed: number; callId: string | null }) => void
}

export function usePublicVoiceCall(options: PublicVoiceCallOptions = {}) {
  const [state, setState] = useState<WebCallState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)

  const providerRef = useRef<GeminiLiveProvider | null>(null)
  const micRef = useRef<MicCapture | null>(null)
  const playerRef = useRef<PcmPlayer | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const callIdRef = useRef<string | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const onEndedRef = useRef(options.onEnded)
  onEndedRef.current = options.onEnded

  const teardown = useCallback(async () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    try { await providerRef.current?.close() } catch {}
    micRef.current?.stop()
    playerRef.current?.stop()
    providerRef.current = null
    micRef.current = null
    playerRef.current = null
  }, [])

  const endCall = useCallback(async (next: WebCallState = 'ended') => {
    await teardown()
    setSecondsLeft(null)
    if (startedAtRef.current !== null) {
      const secsUsed = Math.round((Date.now() - startedAtRef.current) / 1000)
      startedAtRef.current = null
      onEndedRef.current?.({ secsUsed, callId: callIdRef.current })
      callIdRef.current = null
    }
    setState(next)
  }, [teardown])

  const startCall = useCallback(async () => {
    setError(null)
    setState('connecting')

    // Pre-flight the mic BEFORE minting a token: getUserMedia is where a
    // denied/dismissed permission prompt throws, and it used to run after
    // the mint — so one fumbled prompt burned the visitor's cooldown AND
    // a call slot, then surfaced a cryptic "Permission denied". Ask first;
    // if the browser says no, nothing server-side is consumed and the
    // visitor can fix the permission and retry immediately.
    try {
      const preflight = await navigator.mediaDevices.getUserMedia({ audio: true })
      preflight.getTracks().forEach(t => t.stop())
    } catch {
      setError('Your browser blocked the microphone — click the mic icon in the address bar, allow it for this site, and try again.')
      setState('error')
      return
    }

    try {
      const res = await fetch(options.tokenEndpoint ?? '/api/public/voice-demo/web-token', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (res.status === 503) { setState('unavailable'); return }
      if (!res.ok) throw new Error(data.error || 'Could not start the voice session.')

      const { connection, tools, vendorConfig, maxSessionSecs } = data
      callIdRef.current = typeof data.callId === 'string' ? data.callId : null
      startedAtRef.current = Date.now()

      const provider = new GeminiLiveProvider()
      const player = new PcmPlayer()
      await player.start()
      const mic = new MicCapture((chunk: string) => provider.sendAudioChunk(chunk))

      provider.onAudioOutput = (pcm) => player.enqueue(pcm)
      provider.onInterrupted = () => player.flush()
      provider.onToolCall = async () => ({ error: 'not available in demo' }) // no real actions in the public demo
      provider.onError = (msg: string) => { setError(msg); void endCall('error') }
      provider.onEnded = () => { void endCall('ended') }

      await provider.connect({ connection, tools, vendorConfig })
      await mic.start()
      providerRef.current = provider
      micRef.current = mic
      playerRef.current = player

      const cap = Number(maxSessionSecs || connection?.maxSessionSecs || 120)
      setSecondsLeft(cap)
      timerRef.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s === null) return s
          if (s <= 1) { void endCall('ended'); return 0 }
          return s - 1
        })
      }, 1000)
      setState('live')
    } catch (err) {
      // Mic can still fail here (permission revoked between preflight and
      // capture) — keep the friendly wording for that case too.
      const micDenied = err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'NotFoundError')
      setError(
        micDenied
          ? 'Your browser blocked the microphone — click the mic icon in the address bar, allow it for this site, and try again.'
          : err instanceof Error ? err.message : 'Voice session failed.',
      )
      micRef.current?.stop()
      playerRef.current?.stop()
      // If the token was already minted (startedAt set) but connect/mic
      // failed, endCall never runs — fire onEnded here so the caller's
      // telemetry (e.g. the call-end beacon) still sees the call, and
      // the refs don't go stale for the next attempt.
      if (startedAtRef.current !== null) {
        const secsUsed = Math.round((Date.now() - startedAtRef.current) / 1000)
        startedAtRef.current = null
        onEndedRef.current?.({ secsUsed, callId: callIdRef.current })
        callIdRef.current = null
      }
      setState('error')
    }
  }, [endCall, options.tokenEndpoint])

  // Tear down if the component unmounts mid-call.
  useEffect(() => () => { void teardown() }, [teardown])

  const reset = useCallback(() => { setState('idle'); setError(null); setSecondsLeft(null) }, [])

  return { state, error, secondsLeft, startCall, endCall, reset }
}
