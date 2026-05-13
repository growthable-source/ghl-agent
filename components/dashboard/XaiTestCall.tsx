'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * XAI voice test-call component — HYBRID architecture.
 *
 * XAI realtime is used only for STT (transcribing the user's mic
 * audio). The "brain" runs server-side through Claude with the agent's
 * full tool catalogue — this is what lets the voice agent actually
 * call Shopify / CRM tools, which XAI realtime doesn't reliably do.
 *
 * Flow:
 *   1. Mint XAI realtime token (no agentId needed — no realtime tools).
 *   2. Open wss://api.x.ai/v1/realtime.
 *   3. session.update with create_response: false so XAI ONLY
 *      transcribes, doesn't generate replies.
 *   4. Capture mic at 24 kHz PCM16, stream to XAI; XAI emits
 *      conversation.item.input_audio_transcription.completed events
 *      with the user's transcript.
 *   5. On each user transcript: POST to /api/voice/agent-turn with
 *      the rolling history. Server runs Claude + tools + XAI batch
 *      TTS, returns { reply, audioBase64, toolCalls }.
 *   6. Queue audioBase64 (mp3) into the audio context for playback.
 *
 * Uses ScriptProcessorNode for capture. Deprecated but universally
 * supported; AudioWorklet would be cleaner but adds build complexity.
 */

interface Props {
  voiceId: string
  agentName: string
  /** Unused in hybrid mode — system prompt + tools live server-side now. Kept for back-compat. */
  systemPrompt?: string
  firstMessage?: string | null
  /**
   * Agent ID — required for the hybrid path. Each user transcript
   * is POSTed to /api/voice/agent-turn with this id; the server
   * looks up the agent, builds the system prompt, runs Claude with
   * the agent's tools, and returns the spoken reply.
   */
  agentId: string
}

interface TranscriptLine { role: 'user' | 'assistant'; text: string }

// Tunable — XAI realtime accepts 24kHz PCM16 input and produces the same
// in response.output_audio.delta. Matching sample rate end-to-end avoids
// quality loss from resampling.
const SAMPLE_RATE = 24000

export default function XaiTestCall({ voiceId, agentName, firstMessage, agentId }: Props) {
  const [status, setStatus] = useState<'idle' | 'connecting' | 'active' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const transcriptRef = useRef<HTMLDivElement>(null)

  // WebSocket + audio plumbing — refs so React re-renders don't restart
  // the pipeline mid-call.
  const wsRef = useRef<WebSocket | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  // Play head so server-TTS replies queue sequentially instead of
  // overlapping. Each reply bumps it forward by the clip's duration.
  const playheadRef = useRef<number>(0)
  // Streaming transcript building — accumulate assistant deltas into the
  // last assistant line and user input into the last user line.
  const currentUserLineRef = useRef<number | null>(null)
  const currentAssistantLineRef = useRef<number | null>(null)
  // Rolling history of the call's turns, sent with each agent-turn POST
  // so Claude sees context. Capped to the last N turns server-side.
  const historyRef = useRef<{ role: 'user' | 'assistant'; content: string }[]>([])
  // De-bounce concurrent turns — if the user keeps talking while a
  // reply is in flight, we drop new transcripts (XAI's VAD usually
  // handles this but be defensive).
  const turnInFlightRef = useRef(false)

  // Autoscroll transcript on update
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' })
  }, [transcript])

  // Cleanup on unmount
  useEffect(() => {
    return () => { stop() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function start() {
    setErrorMsg(null)
    setTranscript([])
    setStatus('connecting')
    currentUserLineRef.current = null
    currentAssistantLineRef.current = null
    historyRef.current = []
    turnInFlightRef.current = false

    try {
      // 1. Mint ephemeral XAI token. No agentId / tools — the brain
      //    runs server-side now; XAI's role is strictly STT + TTS.
      const tokenRes = await fetch('/api/voice/xai/client-secret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresInSeconds: 600 }),
      })
      if (!tokenRes.ok) throw new Error(`Could not mint XAI token: ${await tokenRes.text()}`)
      const { value: token, wsUrl } = await tokenRes.json() as {
        value: string
        wsUrl: string
      }

      // 2. Open WebSocket. XAI takes the token via a subprotocol prefixed
      //    `xai-client-secret.` — browsers don't allow custom headers on WS.
      const ws = new WebSocket(wsUrl, [`xai-client-secret.${token}`])
      wsRef.current = ws

      ws.addEventListener('open', () => {
        // 3. Configure the session for STT-only:
        //    - turn_detection.create_response: false tells XAI to
        //      transcribe but NOT generate its own assistant reply.
        //      That's our server's job.
        //    - input_audio_transcription enables the transcript
        //      events we listen for below.
        //    - We don't set `voice` because XAI isn't generating
        //      audio over the WS; TTS happens server-side per turn.
        const session = {
          input_audio_format: 'pcm16',
          input_audio_transcription: { model: 'whisper-1' },
          turn_detection: {
            type: 'server_vad',
            create_response: false,
            interrupt_response: false,
          },
        }
        ws.send(JSON.stringify({ type: 'session.update', session }))

        // Open with the configured first message so the caller hears
        // a greeting instead of silence. Speaks via the same hybrid
        // path: text → POST → TTS → play.
        if (firstMessage) {
          speakAssistantReply(firstMessage, /* skipHistory */ false)
        }
      })

      ws.addEventListener('message', ev => handleServerMessage(ev.data))
      ws.addEventListener('error', () => {
        setErrorMsg('WebSocket error. Check XAI_API_KEY and network connectivity.')
        setStatus('error')
      })
      ws.addEventListener('close', () => {
        if (status !== 'error') setStatus('idle')
        cleanupAudio()
      })

      // 4. Set up mic capture + outgoing audio loop
      await startMicCapture(ws)

      setStatus('active')
    } catch (err: any) {
      setErrorMsg(err.message ?? 'Failed to start call')
      setStatus('error')
      cleanupAudio()
      wsRef.current?.close()
    }
  }

  async function startMicCapture(ws: WebSocket) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    micStreamRef.current = stream

    // @ts-expect-error Safari uses webkitAudioContext
    const Ctx = (window.AudioContext || window.webkitAudioContext) as typeof AudioContext
    const audioCtx = new Ctx({ sampleRate: SAMPLE_RATE })
    audioCtxRef.current = audioCtx
    playheadRef.current = audioCtx.currentTime

    const source = audioCtx.createMediaStreamSource(stream)
    sourceNodeRef.current = source

    // ScriptProcessor is deprecated in favour of AudioWorklet but it ships
    // in every browser today with zero build setup. The perf cost is
    // negligible at 24kHz single-channel.
    const processor = audioCtx.createScriptProcessor(4096, 1, 1)
    processorRef.current = processor

    processor.onaudioprocess = e => {
      if (ws.readyState !== WebSocket.OPEN) return
      const input = e.inputBuffer.getChannelData(0) // Float32, [-1, 1]
      const pcm16 = floatToPCM16(input)
      const b64 = bufferToBase64(pcm16.buffer as ArrayBuffer)
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }))
    }

    source.connect(processor)
    // ScriptProcessor only fires events when connected to a destination.
    // Piping to the context destination would echo the mic; route to a
    // muted gain node instead.
    const silentSink = audioCtx.createGain()
    silentSink.gain.value = 0
    processor.connect(silentSink)
    silentSink.connect(audioCtx.destination)
  }

  function handleServerMessage(raw: string | ArrayBuffer) {
    if (typeof raw !== 'string') return
    let msg: any
    try { msg = JSON.parse(raw) } catch { return }

    switch (msg.type) {
      case 'session.created':
      case 'session.updated':
      case 'conversation.created':
      case 'input_audio_buffer.speech_started':
      case 'input_audio_buffer.speech_stopped':
      case 'input_audio_buffer.committed':
      case 'conversation.item.created':
        break

      case 'conversation.item.input_audio_transcription.completed': {
        // The user's audio was transcribed — this is the entry point
        // for the hybrid turn loop. Show what they said, then ship
        // the transcript to our server for Claude + tools + TTS.
        const text = (msg.transcript ?? '').trim()
        if (!text) break
        appendUser(text)
        currentUserLineRef.current = null
        if (turnInFlightRef.current) {
          console.warn('[voice] dropping user transcript — previous turn still in flight')
          break
        }
        runAgentTurn(text)
        break
      }

      case 'error': {
        const errText = msg.error?.message ?? JSON.stringify(msg.error) ?? 'XAI realtime error'
        console.error('[voice] error event:', msg.error)
        setErrorMsg(errText)
        setTranscript(prev => [...prev, { role: 'assistant', text: `❌ ${errText}` }])
        break
      }
      default:
        console.log('[voice] unhandled event:', msg.type, msg)
    }
  }

  /**
   * Send the user's transcript to /api/voice/agent-turn. The server
   * runs Claude with the agent's full tool catalogue (Shopify / CRM /
   * etc.), generates a reply, runs it through XAI batch TTS, and
   * returns audio bytes. We queue the audio for playback + render
   * the reply + tool calls in the transcript.
   */
  async function runAgentTurn(userText: string) {
    turnInFlightRef.current = true
    try {
      const res = await fetch('/api/voice/agent-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          transcript: userText,
          voiceId,
          history: historyRef.current,
        }),
      })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        throw new Error(`agent-turn HTTP ${res.status}: ${errBody.slice(0, 200)}`)
      }
      const { reply, audioBase64, mimeType, toolCalls } = await res.json() as {
        reply: string
        audioBase64: string
        mimeType: string
        toolCalls: { name: string; ms: number }[]
      }

      // Surface tool calls inline in the transcript so the operator
      // sees the agent's hands moving (which was the missing signal
      // last time around).
      if (Array.isArray(toolCalls)) {
        for (const tc of toolCalls) {
          setTranscript(prev => [...prev, {
            role: 'assistant',
            text: `🔧 ${tc.name} · ${tc.ms}ms`,
          }])
        }
      }

      appendAssistant(reply)
      currentAssistantLineRef.current = null

      // Maintain rolling history for the next turn so Claude sees
      // continuity. Keep last 20 turns; the server caps internally too.
      historyRef.current = [
        ...historyRef.current,
        { role: 'user' as const, content: userText },
        { role: 'assistant' as const, content: reply },
      ].slice(-20)

      if (audioBase64 && mimeType) {
        await queueMp3Reply(audioBase64)
      }
    } catch (err: any) {
      console.error('[voice] agent turn failed:', err)
      setTranscript(prev => [...prev, { role: 'assistant', text: `❌ ${err?.message ?? 'agent turn failed'}` }])
    } finally {
      turnInFlightRef.current = false
    }
  }

  /**
   * Play the configured first message via /api/voice/tts (skips
   * Claude — it's just static text). Doesn't update history; the
   * model doesn't need to see its own greeting as context.
   */
  async function speakAssistantReply(text: string, skipHistory: boolean) {
    try {
      appendAssistant(text)
      currentAssistantLineRef.current = null
      if (!skipHistory) {
        historyRef.current = [...historyRef.current, { role: 'assistant' as const, content: text }]
      }
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voiceId }),
      })
      if (!res.ok) return
      const { audioBase64, mimeType } = await res.json() as { audioBase64: string; mimeType: string }
      if (audioBase64 && mimeType) await queueMp3Reply(audioBase64)
    } catch (err) {
      console.warn('[voice] greeting TTS failed:', err)
    }
  }

  /**
   * Decode an MP3 reply (base64) into the audio context and queue it
   * for sequential playback. Uses the same playheadRef approach as
   * the realtime PCM path so concurrent replies don't overlap.
   */
  async function queueMp3Reply(b64: string): Promise<void> {
    const ctx = audioCtxRef.current
    if (!ctx) return
    try {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer)
      const src = ctx.createBufferSource()
      src.buffer = buffer
      src.connect(ctx.destination)
      const startAt = Math.max(playheadRef.current, ctx.currentTime)
      src.start(startAt)
      playheadRef.current = startAt + buffer.duration
    } catch (err) {
      console.warn('[voice] mp3 decode failed:', err)
    }
  }

  function appendAssistant(delta: string) {
    setTranscript(prev => {
      const idx = currentAssistantLineRef.current
      if (idx !== null && prev[idx]) {
        const next = [...prev]
        next[idx] = { role: 'assistant', text: next[idx].text + delta }
        return next
      }
      const newIdx = prev.length
      currentAssistantLineRef.current = newIdx
      return [...prev, { role: 'assistant', text: delta }]
    })
  }
  function appendUser(text: string) {
    setTranscript(prev => [...prev, { role: 'user', text }])
  }

  function stop() {
    wsRef.current?.close()
    wsRef.current = null
    cleanupAudio()
    setStatus('idle')
  }
  function cleanupAudio() {
    processorRef.current?.disconnect()
    sourceNodeRef.current?.disconnect()
    micStreamRef.current?.getTracks().forEach(t => t.stop())
    audioCtxRef.current?.close().catch(() => {})
    processorRef.current = null
    sourceNodeRef.current = null
    micStreamRef.current = null
    audioCtxRef.current = null
  }

  return (
    <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-zinc-200">Test Call · XAI</p>
          <p className="text-xs text-zinc-500 mt-0.5">
            Streams through XAI Realtime WebSocket. Uses your mic — allow access when prompted.
          </p>
        </div>
        {status !== 'active' && status !== 'connecting' ? (
          <button type="button" onClick={start}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-white" />
            Start call
          </button>
        ) : (
          <button type="button" onClick={stop}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            {status === 'connecting' ? 'Connecting…' : 'End call'}
          </button>
        )}
      </div>

      {errorMsg && (
        <p className="text-xs text-red-400">{errorMsg}</p>
      )}

      {transcript.length > 0 && (
        <div ref={transcriptRef} className="max-h-64 overflow-y-auto space-y-2 bg-zinc-900 rounded-lg p-3">
          {transcript.map((line, i) => (
            <div key={i} className={`flex ${line.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                line.role === 'user'
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-800/30'
                  : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
              }`}>
                <p className="text-xs text-zinc-500 mb-0.5">{line.role === 'user' ? 'You' : agentName}</p>
                {line.text}
              </div>
            </div>
          ))}
        </div>
      )}

      {status === 'idle' && transcript.length === 0 && (
        <p className="text-xs text-zinc-500 text-center py-4">Click Start call to test.</p>
      )}
    </div>
  )
}

// ── Audio encoding helpers ───────────────────────────────────────────────

function floatToPCM16(float32: Float32Array): Int16Array {
  const pcm = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return pcm
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}
