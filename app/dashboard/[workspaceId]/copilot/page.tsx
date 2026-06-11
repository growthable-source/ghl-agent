'use client'

/**
 * Co-Pilot — live session surface (v0).
 *
 * Orchestrates a full realtime session, browser-direct to the model:
 *
 *   start → screen-share + mic permissions → POST /api/copilot/sessions
 *   (plan gate + ephemeral token) → provider.connect → live loop:
 *     mic chunks ↑, throttled screen frames ↑, model audio ↓,
 *     transcripts ↓, tool calls round-tripped through our backend.
 *
 * The page depends on the RealtimeModelProvider interface only —
 * GeminiLiveProvider is instantiated from the provider id the server
 * returns, so a gpt-realtime fallback slots in here without UI work.
 *
 * Persistence: final transcript turns + screen events + cost counter
 * deltas flush to the event sink every 5 s and once more (keepalive)
 * at session end. Raw frames are never sent to our backend — only to
 * the model (§11).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import type { RealtimeModelProvider, RealtimeToolDef, RealtimeConnectionInfo } from '@/lib/copilot/types'
import { GeminiLiveProvider } from '@/lib/copilot/providers/gemini-live'
import { MicCapture, PcmPlayer } from '@/lib/copilot/audio-client'
import { ScreenFrameCapture } from '@/lib/copilot/frame-capture'

type Phase =
  | { kind: 'idle' }
  | { kind: 'starting'; step: string }
  | { kind: 'live' }
  | { kind: 'ended'; reason: string; taskSuccess: boolean | null; durationSecs: number }
  | { kind: 'gated'; message: string }
  | { kind: 'error'; message: string }

interface FeedItem {
  id: number
  role: 'user' | 'agent' | 'tool'
  text: string
}

interface BufferedTurn {
  role: string
  text: string
  ts: string
}

interface BufferedScreenEvent {
  detectedContext: Record<string, unknown>
  ts: string
}

const FLUSH_INTERVAL_MS = 5000

export default function CopilotPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [partial, setPartial] = useState<{ user: string; agent: string }>({ user: '', agent: '' })
  const [muted, setMuted] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  // Session machinery lives in refs — none of it should re-render.
  const sessionIdRef = useRef<string | null>(null)
  const providerRef = useRef<RealtimeModelProvider | null>(null)
  const micRef = useRef<MicCapture | null>(null)
  const playerRef = useRef<PcmPlayer | null>(null)
  const framesRef = useRef<ScreenFrameCapture | null>(null)
  const displayStreamRef = useRef<MediaStream | null>(null)
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const feedEndRef = useRef<HTMLDivElement | null>(null)
  const turnBufferRef = useRef<BufferedTurn[]>([])
  const screenBufferRef = useRef<BufferedScreenEvent[]>([])
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

  const flushEvents = useCallback(async (final = false) => {
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
      await fetch(`/api/copilot/sessions/${sessionId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turns, screenEvents, counters }),
        ...(final ? { keepalive: true } : {}),
      })
    } catch {
      // Event sink is best-effort: a missed flush loses telemetry,
      // never the live session. Buffers for THIS batch are gone, but
      // future batches keep flowing.
    }
  }, [])

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

      let taskSuccess: boolean | null = null
      let durationSecs = 0
      const sessionId = sessionIdRef.current
      if (sessionId) {
        try {
          const res = await fetch(`/api/copilot/sessions/${sessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endedReason: reason }),
            keepalive: true,
          })
          const body = await res.json().catch(() => ({}))
          taskSuccess = typeof body.taskSuccess === 'boolean' ? body.taskSuccess : null
          durationSecs = typeof body.durationSecs === 'number' ? body.durationSecs : 0
        } catch {
          // Session row stays 'active' until the server-side max-
          // duration sweep flips it; nothing actionable client-side.
        }
      }

      setPhase({ kind: 'ended', reason, taskSuccess, durationSecs })
    },
    [flushEvents],
  )

  // Best-effort cleanup if the user navigates away mid-session.
  useEffect(() => {
    return () => {
      if (sessionIdRef.current && !endingRef.current) {
        void endSession('navigated_away')
      }
    }
  }, [endSession])

  const start = useCallback(async () => {
    if (!workspaceId) return
    endingRef.current = false
    setFeed([])
    setPartial({ user: '', agent: '' })
    setElapsed(0)
    flushedCountersRef.current = { audioIn: 0, audioOut: 0, frames: 0 }

    try {
      // Screen share FIRST — getDisplayMedia must run inside the user
      // gesture. Everything else can follow async.
      setPhase({ kind: 'starting', step: 'Pick the screen or window to share…' })
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5 },
        audio: false,
      })
      displayStreamRef.current = displayStream

      setPhase({ kind: 'starting', step: 'Creating session…' })
      const res = await fetch('/api/copilot/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, locale: 'en-AU' }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        session?: { id: string }
        realtime?: RealtimeConnectionInfo
        liveConfig?: Record<string, unknown>
        tools?: RealtimeToolDef[]
      }
      if (!res.ok || !body.session || !body.realtime) {
        displayStream.getTracks().forEach(t => t.stop())
        if (res.status === 402 || res.status === 503) {
          setPhase({ kind: 'gated', message: body.error || 'Co-Pilot is not available here yet.' })
        } else {
          setPhase({ kind: 'error', message: body.error || `Session create failed (HTTP ${res.status})` })
        }
        return
      }
      sessionIdRef.current = body.session.id
      maxSecsRef.current = body.realtime.maxSessionSecs

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
        const label = call.name === 'query_knowledge' ? 'Searching the knowledge base…' : 'Checking workspace state…'
        pushFeed('tool', label)
        turnBufferRef.current.push({ role: 'tool', text: `${call.name}(${JSON.stringify(call.args)})`, ts: new Date().toISOString() })
        const r = await fetch(`/api/copilot/sessions/${sessionIdRef.current}/tool`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: call.name, args: call.args }),
        })
        const data = (await r.json().catch(() => ({}))) as { result?: string }
        return { result: data.result ?? 'Tool execution failed.' }
      }
      provider.onError = message => console.error('[Copilot] provider error:', message)
      provider.onEnded = reason => void endSession(reason)

      setPhase({ kind: 'starting', step: 'Connecting to the co-pilot…' })
      await provider.connect({
        connection: body.realtime,
        tools: body.tools ?? [],
        vendorConfig: body.liveConfig,
      })

      const frames = new ScreenFrameCapture(displayStream, body.realtime.frameFpsCap, frame => {
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
      // Browser-level "Stop sharing" button ends the session cleanly.
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
      // Permission denial is a normal path, not an error banner.
      if (/Permission|NotAllowed/i.test(message)) {
        setPhase({ kind: 'idle' })
      } else {
        setPhase({ kind: 'error', message })
      }
    }
  }, [workspaceId, endSession, flushEvents, pushFeed])

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

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 w-full">
      <div className="mb-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-orange-50 text-orange-700 text-xs font-medium mb-3">
          <span className={`w-1.5 h-1.5 rounded-full bg-orange-500 ${phase.kind === 'live' ? 'animate-pulse' : ''}`} />
          {phase.kind === 'live' ? 'Live session' : 'Preview'}
        </div>
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">Co-Pilot</h1>
        <p className="text-gray-600 leading-relaxed max-w-2xl">
          Share your screen and talk — the co-pilot watches what you&rsquo;re doing and walks you
          through setup in real time. It guides, you click: it can&rsquo;t change anything itself.
        </p>
      </div>

      {phase.kind === 'idle' && (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-orange-100 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="w-7 h-7 text-orange-600">
              <rect x="2" y="4" width="20" height="14" rx="2" />
              <circle cx="12" cy="11" r="3" />
            </svg>
          </div>
          <h2 className="text-lg font-medium text-gray-900 mb-1">Start a live help session</h2>
          <p className="text-sm text-gray-600 mb-5 max-w-md mx-auto">
            You&rsquo;ll be asked to share your screen and microphone. Sessions are capped at 30
            minutes; your screen is never recorded — only the conversation transcript is kept.
          </p>
          <button
            type="button"
            onClick={() => void start()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-orange-500 text-white font-medium hover:bg-orange-600 transition"
          >
            Share screen &amp; start talking
          </button>
        </div>
      )}

      {phase.kind === 'starting' && (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <div className="mx-auto mb-4 w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-gray-600">{phase.step}</p>
        </div>
      )}

      {phase.kind === 'gated' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <div className="font-medium mb-0.5">Not available in this workspace yet</div>
          <div>{phase.message}</div>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-900">
          <div className="font-medium mb-0.5">Something went wrong</div>
          <div className="mb-3">{phase.message}</div>
          <button
            type="button"
            onClick={() => setPhase({ kind: 'idle' })}
            className="px-3 py-1.5 rounded-lg bg-white border border-red-200 text-red-700 text-sm font-medium hover:bg-red-100 transition"
          >
            Try again
          </button>
        </div>
      )}

      {phase.kind === 'ended' && (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <h2 className="text-lg font-medium text-gray-900 mb-1">Session ended</h2>
          <p className="text-sm text-gray-600 mb-1">
            {mmss(phase.durationSecs)} · {phase.reason.replace(/_/g, ' ')}
          </p>
          {phase.taskSuccess !== null && (
            <p className={`text-sm font-medium mb-4 ${phase.taskSuccess ? 'text-emerald-700' : 'text-gray-500'}`}>
              {phase.taskSuccess ? '✓ Setup goal reached during this session' : 'Setup goal not reached yet — pick up where you left off any time'}
            </p>
          )}
          <button
            type="button"
            onClick={() => setPhase({ kind: 'idle' })}
            className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 text-white font-medium hover:bg-orange-600 transition"
          >
            Start another session
          </button>
        </div>
      )}

      {phase.kind === 'live' && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* Left: screen preview + controls */}
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-xl border border-gray-200 bg-gray-900 overflow-hidden">
              <video ref={previewVideoRef} muted playsInline className="w-full aspect-video object-contain" />
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-900">Session</span>
                <span className="font-mono text-sm text-gray-600">
                  {mmss(elapsed)} / {mmss(maxSecsRef.current)}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={toggleMute}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition ${
                    muted
                      ? 'bg-amber-50 border-amber-300 text-amber-800'
                      : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {muted ? 'Unmute mic' : 'Mute mic'}
                </button>
                <button
                  type="button"
                  onClick={() => void endSession('user_ended')}
                  className="flex-1 px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition"
                >
                  End session
                </button>
              </div>
            </div>
            {suggestion && (
              <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
                <div className="text-xs font-semibold text-orange-700 uppercase tracking-wide mb-1">
                  Co-pilot says
                </div>
                <p className="text-sm text-orange-950 leading-relaxed">{suggestion}</p>
              </div>
            )}
          </div>

          {/* Right: transcript feed */}
          <div className="lg:col-span-3 rounded-xl border border-gray-200 bg-white flex flex-col" style={{ maxHeight: '34rem' }}>
            <div className="px-4 py-3 border-b border-gray-100 text-sm font-medium text-gray-900">
              Live transcript
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {feed.length === 0 && !partial.user && !partial.agent && (
                <p className="text-sm text-gray-400 text-center py-8">
                  Say hello — the co-pilot is listening and can see your screen.
                </p>
              )}
              {feed.map(item => (
                <div key={item.id} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {item.role === 'tool' ? (
                    <span className="text-xs text-gray-400 italic">{item.text}</span>
                  ) : (
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                        item.role === 'user' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-900'
                      }`}
                    >
                      {item.text}
                    </div>
                  )}
                </div>
              ))}
              {partial.user && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl px-3.5 py-2 text-sm bg-orange-300 text-white">
                    {partial.user}
                  </div>
                </div>
              )}
              {partial.agent && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl px-3.5 py-2 text-sm bg-gray-50 text-gray-600 border border-gray-100">
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
