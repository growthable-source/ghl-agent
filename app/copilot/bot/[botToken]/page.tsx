'use client'

/**
 * Meeting-bot page — loaded by the Recall bot's headless browser
 * inside a Zoom/Meet/Teams call. Two jobs:
 *
 *   1. RUN the realtime session: the page's microphone IS the
 *      meeting's mixed audio (Recall grants mic access automatically),
 *      and any audio the page plays goes out as the bot's voice. Same
 *      GeminiLiveProvider/MicCapture/PcmPlayer stack as the in-app
 *      panel — this page is just a different host for it.
 *   2. BE the bot's camera tile: whatever this page renders streams
 *      into the meeting at 1280x720. So it renders a clean "AI
 *      assistant" card — name, listening/speaking state, live caption.
 *
 * No NextAuth — the [botToken] path segment is the per-session
 * credential, minted server-side and known only to Recall's browser.
 * Deliberately styled with literal colors, not theme tokens: this is
 * a video feed, not dashboard UI, and must not follow user themes.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import type { RealtimeModelProvider, RealtimeToolDef, RealtimeConnectionInfo } from '@/lib/copilot/types'
import { GeminiLiveProvider } from '@/lib/copilot/providers/gemini-live'
import { MicCapture, PcmPlayer } from '@/lib/copilot/audio-client'

const FLUSH_INTERVAL_MS = 5000
const SPEAKING_HOLD_MS = 700

type Phase = 'connecting' | 'live' | 'ended' | 'error'

export default function MeetingBotPage() {
  const params = useParams<{ botToken: string }>()
  const botToken = params?.botToken

  const [phase, setPhase] = useState<Phase>('connecting')
  const [agentName, setAgentName] = useState('Assistant')
  const [workspaceName, setWorkspaceName] = useState('')
  const [caption, setCaption] = useState('')
  const [speaking, setSpeaking] = useState(false)

  const providerRef = useRef<RealtimeModelProvider | null>(null)
  const micRef = useRef<MicCapture | null>(null)
  const playerRef = useRef<PcmPlayer | null>(null)
  const turnBufferRef = useRef<Array<{ role: string; text: string; ts: string }>>([])
  const flushedRef = useRef({ audioIn: 0, audioOut: 0 })
  const lastAudioAtRef = useRef(0)
  const endedRef = useRef(false)
  const startedRef = useRef(false)

  const api = useCallback(
    (op: string) => `/api/copilot/meeting/${botToken}?op=${op}`,
    [botToken],
  )

  const flushEvents = useCallback(async () => {
    if (!botToken) return
    const turns = turnBufferRef.current.splice(0)
    const audioIn = micRef.current?.capturedSecs ?? 0
    const audioOut = playerRef.current?.playedSecs ?? 0
    const sent = flushedRef.current
    const counters = {
      audioInSecs: Math.max(0, Math.round((audioIn - sent.audioIn) * 100) / 100),
      audioOutSecs: Math.max(0, Math.round((audioOut - sent.audioOut) * 100) / 100),
    }
    if (turns.length === 0 && counters.audioInSecs === 0 && counters.audioOutSecs === 0) return
    flushedRef.current = { audioIn, audioOut }
    try {
      await fetch(api('events'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turns, counters }),
      })
    } catch {
      // Best-effort telemetry — never kills the call.
    }
  }, [api, botToken])

  const endSession = useCallback(
    (reason: string) => {
      if (endedRef.current) return
      endedRef.current = true
      micRef.current?.stop()
      playerRef.current?.stop()
      void providerRef.current?.close().catch(() => undefined)
      void flushEvents()
      try {
        navigator.sendBeacon(
          api('end'),
          new Blob([JSON.stringify({ endedReason: reason })], { type: 'application/json' }),
        )
      } catch {
        void fetch(api('end'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endedReason: reason }),
          keepalive: true,
        }).catch(() => undefined)
      }
      setPhase('ended')
    },
    [api, flushEvents],
  )

  useEffect(() => {
    if (!botToken || startedRef.current) return
    startedRef.current = true

    let flushTimer: ReturnType<typeof setInterval> | null = null
    let speakTimer: ReturnType<typeof setInterval> | null = null

    const start = async () => {
      try {
        const res = await fetch(api('connect'), { method: 'POST' })
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          error?: string
          realtime?: RealtimeConnectionInfo
          liveConfig?: Record<string, unknown>
          tools?: RealtimeToolDef[]
          display?: { agentName?: string; workspaceName?: string }
        }
        if (!res.ok || !body.ok || !body.realtime) {
          setPhase('error')
          console.error('[MeetingBot] connect failed:', body.error || res.status)
          return
        }
        setAgentName(body.display?.agentName || 'Assistant')
        setWorkspaceName(body.display?.workspaceName || '')

        const player = new PcmPlayer()
        await player.start()
        playerRef.current = player

        const provider = new GeminiLiveProvider()
        providerRef.current = provider

        // The page's "mic" is the meeting's mixed audio — Recall wires
        // it up and grants the permission with no prompt.
        const mic = new MicCapture(chunk => provider.sendAudioChunk(chunk))
        await mic.start()
        micRef.current = mic

        provider.onAudioOutput = b64 => {
          player.enqueue(b64)
          lastAudioAtRef.current = Date.now()
        }
        provider.onInterrupted = () => player.flush()
        provider.onTranscript = turn => {
          if (turn.role === 'agent') setCaption(turn.text)
          if (turn.final) {
            turnBufferRef.current.push({ role: turn.role, text: turn.text, ts: new Date().toISOString() })
          }
        }
        provider.onToolCall = async call => {
          turnBufferRef.current.push({
            role: 'tool',
            text: `${call.name}(${JSON.stringify(call.args)})`,
            ts: new Date().toISOString(),
          })
          const r = await fetch(api('tool'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: call.name, args: call.args }),
          })
          const data = (await r.json().catch(() => ({}))) as { result?: string }
          return { result: data.result ?? 'The tool call failed — be honest about not being able to check.' }
        }
        provider.onError = message => console.error('[MeetingBot] provider error:', message)
        provider.onEnded = reason => endSession(reason)

        await provider.connect({
          connection: body.realtime,
          tools: body.tools ?? [],
          vendorConfig: body.liveConfig,
        })

        flushTimer = setInterval(() => void flushEvents(), FLUSH_INTERVAL_MS)
        speakTimer = setInterval(() => {
          setSpeaking(Date.now() - lastAudioAtRef.current < SPEAKING_HOLD_MS)
        }, 200)
        setPhase('live')
      } catch (err) {
        console.error('[MeetingBot] start failed:', err)
        setPhase('error')
      }
    }
    void start()

    // pagehide is the real teardown signal — Recall kills the page when
    // the bot leaves the call. Deliberately NOT ending the session in
    // the effect cleanup: React dev double-mounting would end it before
    // the call even starts, and this component never unmounts otherwise.
    const onPageHide = () => endSession('meeting_ended')
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      if (flushTimer) clearInterval(flushTimer)
      if (speakTimer) clearInterval(speakTimer)
    }
  }, [botToken, api, endSession, flushEvents])

  const initial = (agentName || 'A').trim().charAt(0).toUpperCase()
  const statusText =
    phase === 'connecting' ? 'Joining…' : phase === 'live' ? (speaking ? 'Speaking' : 'Listening') : phase === 'ended' ? 'Call ended' : 'Connection problem'
  const statusColor = phase === 'error' ? '#f87171' : speaking ? '#fa4d2e' : phase === 'live' ? '#34d399' : '#a1a1aa'

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 28,
        background: 'radial-gradient(120% 120% at 50% 0%, #181c26 0%, #0b0e14 65%)',
        color: '#fff',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'relative', width: 168, height: 168 }}>
        {speaking && (
          <div
            style={{
              position: 'absolute',
              inset: -14,
              borderRadius: '50%',
              border: '3px solid #fa4d2e',
              opacity: 0.7,
              animation: 'bot-pulse 1.1s ease-in-out infinite',
            }}
          />
        )}
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 64,
            fontWeight: 600,
            background: 'linear-gradient(135deg, #fa4d2e 0%, #c2330f 100%)',
            boxShadow: '0 18px 60px rgba(250,77,46,0.35)',
          }}
        >
          {initial}
        </div>
      </div>

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40, fontWeight: 650, letterSpacing: -0.5 }}>{agentName}</div>
        {workspaceName && (
          <div style={{ fontSize: 19, color: '#a1a1aa', marginTop: 6 }}>{workspaceName}</div>
        )}
        <div
          style={{
            marginTop: 14,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 9,
            fontSize: 17,
            color: '#d4d4d8',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 999,
            padding: '7px 18px',
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: statusColor,
              boxShadow: `0 0 10px ${statusColor}`,
            }}
          />
          {statusText} · AI assistant
        </div>
      </div>

      <div
        style={{
          minHeight: 76,
          maxWidth: '78%',
          textAlign: 'center',
          fontSize: 23,
          lineHeight: 1.45,
          color: '#e4e4e7',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {phase === 'live' ? caption : phase === 'connecting' ? 'Connecting to the meeting…' : ''}
      </div>

      <style jsx global>{`
        html,
        body {
          margin: 0;
          padding: 0;
          background: #0b0e14;
        }
        @keyframes bot-pulse {
          0%,
          100% {
            transform: scale(1);
            opacity: 0.7;
          }
          50% {
            transform: scale(1.07);
            opacity: 0.25;
          }
        }
      `}</style>
    </div>
  )
}
