'use client'

/**
 * Co-Pilot live session panel — the shared realtime surface.
 *
 * Used by two hosts with different auth worlds:
 *   - the dashboard page (staff; NextAuth cookie)
 *   - the widget live page (visitor; publicKey query auth)
 *
 * The host injects a CopilotTransport that knows how to reach ITS
 * endpoints; the panel owns everything else: permissions, the
 * RealtimeModelProvider, mic/playback, frame throttling, transcript
 * UI, event batching, countdown, and teardown. The panel depends on
 * the provider interface only — vendor swap stays a server-side
 * decision.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeModelProvider, RealtimeToolDef, RealtimeConnectionInfo } from '@/lib/copilot/types'
import { GeminiLiveProvider } from '@/lib/copilot/providers/gemini-live'
import { MicCapture, PcmPlayer } from '@/lib/copilot/audio-client'
import { ScreenFrameCapture } from '@/lib/copilot/frame-capture'

export interface CopilotCreateResult {
  ok: boolean
  status: number
  error?: string
  session?: { id: string }
  realtime?: RealtimeConnectionInfo
  liveConfig?: Record<string, unknown>
  tools?: RealtimeToolDef[]
}

export interface CopilotTransport {
  create(locale: string): Promise<CopilotCreateResult>
  tool(sessionId: string, name: string, args: Record<string, unknown>): Promise<string>
  events(sessionId: string, batch: Record<string, unknown>, final: boolean): Promise<void>
  end(sessionId: string, reason: string): Promise<{ durationSecs: number; goalReached: boolean | null }>
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting'; step: string }
  | { kind: 'live' }
  | { kind: 'ended'; reason: string; goalReached: boolean | null; durationSecs: number }
  | { kind: 'gated'; message: string }
  | { kind: 'error'; message: string }

interface FeedItem {
  id: number
  role: 'user' | 'agent' | 'tool'
  text: string
}

const FLUSH_INTERVAL_MS = 5000

export default function LiveSessionPanel({
  transport,
  accent = '#e84425',
  idleTitle = 'Start a live help session',
  idleBody = 'You’ll be asked to share your screen and microphone. Sessions are capped at 30 minutes; your screen is never recorded — only the conversation transcript is kept.',
  startLabel = 'Share screen & start talking',
  endedGoalCopy,
  onSessionEnded,
}: {
  transport: CopilotTransport
  accent?: string
  idleTitle?: string
  idleBody?: string
  startLabel?: string
  /** Custom copy for the ended card per goal state; defaults provided. */
  endedGoalCopy?: (goalReached: boolean | null) => string | null
  onSessionEnded?: () => void
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [partial, setPartial] = useState<{ user: string; agent: string }>({ user: '', agent: '' })
  const [muted, setMuted] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const sessionIdRef = useRef<string | null>(null)
  const providerRef = useRef<RealtimeModelProvider | null>(null)
  const micRef = useRef<MicCapture | null>(null)
  const playerRef = useRef<PcmPlayer | null>(null)
  const framesRef = useRef<ScreenFrameCapture | null>(null)
  const displayStreamRef = useRef<MediaStream | null>(null)
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const feedEndRef = useRef<HTMLDivElement | null>(null)
  const turnBufferRef = useRef<Array<{ role: string; text: string; ts: string }>>([])
  const screenBufferRef = useRef<Array<{ detectedContext: Record<string, unknown>; ts: string }>>([])
  const flushedCountersRef = useRef({ audioIn: 0, audioOut: 0, frames: 0 })
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const maxSecsRef = useRef(1800)
  const endingRef = useRef(false)
  const feedIdRef = useRef(0)

  const pushFeed = useCallback((role: FeedItem['role'], text: string) => {
    setFeed(prev => [...prev, { id: ++feedIdRef.current, role, text }])
  }, [])

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [feed, partial])

  const flushEvents = useCallback(
    async (final = false) => {
      const sessionId = sessionIdRef.current
      if (!sessionId) return
      const turns = turnBufferRef.current.splice(0)
      const screenEvents = screenBufferRef.current.splice(0)
      const audioIn = micRef.current?.capturedSecs ?? 0
      const audioOut = playerRef.current?.playedSecs ?? 0
      const frames = framesRef.current?.sentFrames ?? 0
      const sent = flushedCountersRef.current
      const counters = {
        audioInSecs: Math.max(0, Math.round((audioIn - sent.audioIn) * 100) / 100),
        audioOutSecs: Math.max(0, Math.round((audioOut - sent.audioOut) * 100) / 100),
        videoFrames: Math.max(0, frames - sent.frames),
      }
      if (
        turns.length === 0 &&
        screenEvents.length === 0 &&
        counters.audioInSecs === 0 &&
        counters.audioOutSecs === 0 &&
        counters.videoFrames === 0
      ) {
        return
      }
      flushedCountersRef.current = { audioIn, audioOut, frames }
      try {
        await transport.events(sessionId, { turns, screenEvents, counters }, final)
      } catch {
        // Best-effort telemetry: a missed flush never kills the session.
      }
    },
    [transport],
  )

  const endSession = useCallback(
    async (reason: string) => {
      if (endingRef.current) return
      endingRef.current = true

      if (flushTimerRef.current) clearInterval(flushTimerRef.current)
      if (tickTimerRef.current) clearInterval(tickTimerRef.current)
      flushTimerRef.current = null
      tickTimerRef.current = null

      framesRef.current?.stop()
      micRef.current?.stop()
      playerRef.current?.stop()
      displayStreamRef.current?.getTracks().forEach(t => t.stop())
      await providerRef.current?.close().catch(() => undefined)

      await flushEvents(true)

      let goalReached: boolean | null = null
      let durationSecs = 0
      const sessionId = sessionIdRef.current
      if (sessionId) {
        try {
          const res = await transport.end(sessionId, reason)
          goalReached = res.goalReached
          durationSecs = res.durationSecs
        } catch {
          // Server-side sweep will close the row; nothing actionable here.
        }
      }

      setPhase({ kind: 'ended', reason, goalReached, durationSecs })
      onSessionEnded?.()
    },
    [flushEvents, transport, onSessionEnded],
  )

  useEffect(() => {
    return () => {
      if (sessionIdRef.current && !endingRef.current) {
        void endSession('navigated_away')
      }
    }
  }, [endSession])

  const start = useCallback(async () => {
    endingRef.current = false
    sessionIdRef.current = null
    setFeed([])
    setPartial({ user: '', agent: '' })
    setElapsed(0)
    flushedCountersRef.current = { audioIn: 0, audioOut: 0, frames: 0 }

    try {
      setPhase({ kind: 'starting', step: 'Pick the screen or window to share…' })
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false,
      })
      displayStreamRef.current = displayStream

      setPhase({ kind: 'starting', step: 'Creating session…' })
      // Locale follows the browser so the voice's accent matches the
      // user, falling back server-side to en-AU.
      const locale = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-AU'
      const created = await transport.create(locale)
      if (!created.ok || !created.session || !created.realtime) {
        displayStream.getTracks().forEach(t => t.stop())
        if (created.status === 402 || created.status === 503) {
          setPhase({ kind: 'gated', message: created.error || 'Live help is not available here yet.' })
        } else {
          setPhase({ kind: 'error', message: created.error || `Session create failed (HTTP ${created.status})` })
        }
        return
      }
      sessionIdRef.current = created.session.id
      maxSecsRef.current = created.realtime.maxSessionSecs

      setPhase({ kind: 'starting', step: 'Connecting microphone…' })
      const player = new PcmPlayer()
      await player.start()
      playerRef.current = player

      const provider = new GeminiLiveProvider()
      providerRef.current = provider

      const mic = new MicCapture(chunk => provider.sendAudioChunk(chunk))
      await mic.start()
      micRef.current = mic

      provider.onAudioOutput = b64 => player.enqueue(b64)
      provider.onInterrupted = () => player.flush()
      provider.onTranscript = turn => {
        if (turn.final) {
          setPartial(p => ({ ...p, [turn.role === 'user' ? 'user' : 'agent']: '' }))
          pushFeed(turn.role, turn.text)
          turnBufferRef.current.push({ role: turn.role, text: turn.text, ts: new Date().toISOString() })
        } else {
          setPartial(p => ({ ...p, [turn.role === 'user' ? 'user' : 'agent']: turn.text }))
        }
      }
      provider.onToolCall = async call => {
        pushFeed('tool', call.name === 'query_knowledge' ? 'Searching the knowledge base…' : 'Checking…')
        turnBufferRef.current.push({
          role: 'tool',
          text: `${call.name}(${JSON.stringify(call.args)})`,
          ts: new Date().toISOString(),
        })
        const result = await transport.tool(sessionIdRef.current!, call.name, call.args)
        return { result }
      }
      provider.onError = message => console.error('[Copilot] provider error:', message)
      provider.onEnded = reason => void endSession(reason)

      setPhase({ kind: 'starting', step: 'Connecting to the co-pilot…' })
      await provider.connect({
        connection: created.realtime,
        tools: created.tools ?? [],
        vendorConfig: created.liveConfig,
      })

      const frames = new ScreenFrameCapture(displayStream, created.realtime.frameFpsCap, frame => {
        provider.sendVideoFrame(frame.base64Jpeg)
        screenBufferRef.current.push({
          detectedContext: { trigger: frame.trigger, diffScore: frame.diffScore },
          ts: new Date().toISOString(),
        })
      })
      await frames.start()
      framesRef.current = frames

      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = displayStream
        void previewVideoRef.current.play().catch(() => undefined)
      }
      displayStream.getVideoTracks()[0]?.addEventListener('ended', () => void endSession('screen_share_stopped'))

      flushTimerRef.current = setInterval(() => void flushEvents(), FLUSH_INTERVAL_MS)
      tickTimerRef.current = setInterval(() => {
        setElapsed(prev => {
          const next = prev + 1
          if (next >= maxSecsRef.current) void endSession('max_duration')
          return next
        })
      }, 1000)

      setPhase({ kind: 'live' })
    } catch (err) {
      displayStreamRef.current?.getTracks().forEach(t => t.stop())
      micRef.current?.stop()
      playerRef.current?.stop()
      const message = err instanceof Error ? err.message : String(err)
      if (/Permission|NotAllowed/i.test(message)) {
        setPhase({ kind: 'idle' })
      } else {
        setPhase({ kind: 'error', message })
      }
    }
  }, [transport, endSession, flushEvents, pushFeed])

  const toggleMute = useCallback(() => {
    setMuted(prev => {
      micRef.current?.setMuted(!prev)
      return !prev
    })
  }, [])

  const mmss = (secs: number) =>
    `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`

  const lastAgentText = [...feed].reverse().find(f => f.role === 'agent')?.text
  const suggestion = partial.agent || lastAgentText

  const goalCopy =
    phase.kind === 'ended'
      ? (endedGoalCopy
          ? endedGoalCopy(phase.goalReached)
          : phase.goalReached === null
            ? null
            : phase.goalReached
              ? '✓ Looks like you got what you needed'
              : 'We’ve flagged this for the team to follow up')
      : null

  return (
    <div className="w-full">
      {phase.kind === 'idle' && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-full flex items-center justify-center" style={{ background: `${accent}1f` }}>
            <svg viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.7" className="w-7 h-7">
              <rect x="2" y="4" width="20" height="14" rx="2" />
              <circle cx="12" cy="11" r="3" />
            </svg>
          </div>
          <h2 className="text-lg font-medium text-zinc-100 mb-1">{idleTitle}</h2>
          <p className="text-sm text-zinc-400 mb-5 max-w-md mx-auto">{idleBody}</p>
          <button
            type="button"
            onClick={() => void start()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-white font-medium transition hover:opacity-90"
            style={{ background: accent }}
          >
            {startLabel}
          </button>
        </div>
      )}

      {phase.kind === 'starting' && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <div
            className="mx-auto mb-4 w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: accent, borderTopColor: 'transparent' }}
          />
          <p className="text-sm text-zinc-400">{phase.step}</p>
        </div>
      )}

      {phase.kind === 'gated' && (
        <div className="rounded-xl border border-zinc-800 bg-accent-amber-bg px-5 py-4 text-sm text-accent-amber">
          <div className="font-medium mb-0.5">Not available right now</div>
          <div>{phase.message}</div>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="rounded-xl border border-zinc-800 bg-accent-red-bg px-5 py-4 text-sm text-accent-red">
          <div className="font-medium mb-0.5">Something went wrong</div>
          <div className="mb-3">{phase.message}</div>
          <button
            type="button"
            onClick={() => setPhase({ kind: 'idle' })}
            className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-700 text-accent-red text-sm font-medium hover:bg-zinc-800 transition"
          >
            Try again
          </button>
        </div>
      )}

      {phase.kind === 'ended' && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center">
          <h2 className="text-lg font-medium text-zinc-100 mb-1">Session ended</h2>
          <p className="text-sm text-zinc-400 mb-1">
            {mmss(phase.durationSecs)} · {phase.reason.replace(/_/g, ' ')}
          </p>
          {goalCopy && <p className="text-sm font-medium mb-4 text-zinc-300">{goalCopy}</p>}
          <button
            type="button"
            onClick={() => setPhase({ kind: 'idle' })}
            className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white font-medium transition hover:opacity-90"
            style={{ background: accent }}
          >
            Start another session
          </button>
        </div>
      )}

      {phase.kind === 'live' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-2 space-y-4">
            {/* True black, not bg-black — that class is remapped to the
                theme background; a video letterbox should stay black. */}
            <div className="rounded-xl border border-zinc-800 overflow-hidden" style={{ background: '#000' }}>
              <video ref={previewVideoRef} muted playsInline className="w-full aspect-video object-contain" />
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-zinc-100">Session</span>
                <span className="font-mono text-sm text-zinc-400">
                  {mmss(elapsed)} / {mmss(maxSecsRef.current)}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={toggleMute}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition ${
                    muted
                      ? 'bg-accent-amber-bg border-accent-amber text-accent-amber'
                      : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {muted ? 'Unmute mic' : 'Mute mic'}
                </button>
                <button
                  type="button"
                  onClick={() => void endSession('user_ended')}
                  className="flex-1 px-3 py-2 rounded-lg bg-accent-red text-white text-sm font-medium hover:opacity-90 transition"
                >
                  End session
                </button>
              </div>
            </div>
            {suggestion && (
              <div className="rounded-xl border p-4" style={{ borderColor: `${accent}55`, background: `${accent}12` }}>
                <div className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: accent }}>
                  Co-pilot says
                </div>
                <p className="text-sm text-zinc-100 leading-relaxed">{suggestion}</p>
              </div>
            )}
          </div>

          <div className="lg:col-span-3 rounded-xl border border-zinc-800 bg-zinc-900 flex flex-col" style={{ maxHeight: '34rem' }}>
            <div className="px-4 py-3 border-b border-zinc-800 text-sm font-medium text-zinc-100">
              Live transcript
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {feed.length === 0 && !partial.user && !partial.agent && (
                <p className="text-sm text-zinc-500 text-center py-8">
                  Say hello — the co-pilot is listening and can see your screen.
                </p>
              )}
              {feed.map(item => (
                <div key={item.id} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {item.role === 'tool' ? (
                    <span className="text-xs text-zinc-500 italic">{item.text}</span>
                  ) : (
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                        item.role === 'user' ? 'text-white' : 'bg-zinc-800 text-zinc-100'
                      }`}
                      style={item.role === 'user' ? { background: accent } : undefined}
                    >
                      {item.text}
                    </div>
                  )}
                </div>
              ))}
              {partial.user && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl px-3.5 py-2 text-sm text-white" style={{ background: `${accent}aa` }}>
                    {partial.user}
                  </div>
                </div>
              )}
              {partial.agent && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl px-3.5 py-2 text-sm bg-zinc-800/60 text-zinc-400 border border-zinc-800">
                    {partial.agent}
                  </div>
                </div>
              )}
              <div ref={feedEndRef} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
