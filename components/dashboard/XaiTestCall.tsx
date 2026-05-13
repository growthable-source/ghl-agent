'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * XAI realtime voice test-call component.
 *
 * Flow:
 *   1. POST /api/voice/xai/client-secret to mint an ephemeral token
 *   2. Open wss://api.x.ai/v1/realtime with the token in the
 *      `sec-websocket-protocol` header (browsers can't set Authorization
 *      on WebSocket — XAI accepts either)
 *   3. Send session.update with voice + system prompt
 *   4. Capture mic at 24 kHz PCM16, base64 each chunk, send via
 *      input_audio_buffer.append (server VAD handles turn detection)
 *   5. Decode response.output_audio.delta base64 → Float32 → AudioBuffer
 *      → queued playback
 *   6. Render response.output_audio_transcript.delta as live captions
 *
 * Uses ScriptProcessorNode for capture. Deprecated but universally
 * supported; AudioWorklet would be cleaner but adds build complexity.
 */

interface Props {
  voiceId: string
  agentName: string
  systemPrompt: string
  firstMessage?: string | null
  /**
   * Agent ID — when present, the client-secret endpoint returns the
   * agent's voice-safe tool list and we wire them into session.update.
   * Function calls during the conversation are POSTed to
   * /api/voice/tool-call for server-side execution. Omit for chitchat-
   * only voice without any tool access.
   */
  agentId?: string
}

/** XAI/OpenAI realtime tool envelope. */
interface RealtimeTool {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

interface TranscriptLine { role: 'user' | 'assistant'; text: string }

// Tunable — XAI realtime accepts 24kHz PCM16 input and produces the same
// in response.output_audio.delta. Matching sample rate end-to-end avoids
// quality loss from resampling.
const SAMPLE_RATE = 24000

export default function XaiTestCall({ voiceId, agentName, systemPrompt, firstMessage, agentId }: Props) {
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
  // Play head so incoming audio deltas queue sequentially instead of
  // overlapping. Each delta bumps it forward by the clip's duration.
  const playheadRef = useRef<number>(0)
  // Streaming transcript building — accumulate assistant deltas into the
  // last assistant line and user input into the last user line.
  const currentUserLineRef = useRef<number | null>(null)
  const currentAssistantLineRef = useRef<number | null>(null)

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

    try {
      // 1. Mint ephemeral token + fetch the agent's voice-safe tool list
      //    in the same round-trip so session.update can include tools
      //    on the very first send.
      const tokenRes = await fetch('/api/voice/xai/client-secret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresInSeconds: 600, agentId }),
      })
      if (!tokenRes.ok) throw new Error(`Could not mint XAI token: ${await tokenRes.text()}`)
      const { value: token, wsUrl, tools } = await tokenRes.json() as {
        value: string
        wsUrl: string
        tools?: RealtimeTool[]
      }
      // Diagnostic: if this is 0 the agent's enabledTools doesn't
      // include any voice-safe tools (most likely cause: the PR A
      // backfill SQL hasn't been run for existing agents, so Shopify
      // tools aren't on the agent yet). Surface it.
      const toolCount = tools?.length ?? 0
      console.log(`[voice] client-secret returned ${toolCount} tool(s):`, tools?.map(t => t.name) ?? [])
      if (toolCount === 0) {
        setTranscript(prev => [...prev, {
          role: 'assistant',
          text: '⚠️ No tools enabled for this agent — agent will reply without live data access. Run the PR A backfill SQL or enable Shopify tools in Agent → Tools.',
        }])
      }

      // 2. Open WebSocket. XAI takes the token via a subprotocol prefixed
      //    `xai-client-secret.` — browsers don't allow custom headers on WS.
      const ws = new WebSocket(wsUrl, [`xai-client-secret.${token}`])
      wsRef.current = ws

      ws.addEventListener('open', () => {
        // 3. Configure the session: voice, system prompt, audio format,
        //    server-side VAD so turn boundaries are handled for us.
        // Build the session payload. `tools` only present when the
        // agent has voice-safe tools enabled — XAI/OpenAI realtime
        // accepts the empty array but omitting it entirely is cleaner.
        const session: Record<string, unknown> = {
          voice: voiceId,
          instructions: systemPrompt +
            '\n\nYou are on a live voice call. Speak naturally. Keep replies to 1–3 sentences. When you call a tool, briefly say something like "let me check" so the caller hears a beat instead of silence.',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          turn_detection: { type: 'server_vad' },
        }
        if (tools && tools.length > 0) {
          session.tools = tools
          session.tool_choice = 'auto'
        }
        ws.send(JSON.stringify({ type: 'session.update', session }))

        // Kick off the first assistant turn so the agent speaks first.
        // Without this the agent waits for user audio before responding —
        // not what you want from a test call.
        if (firstMessage) {
          ws.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: firstMessage }],
            },
          }))
        }
        ws.send(JSON.stringify({ type: 'response.create' }))
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
        console.log('[voice] session.created — server confirmed connection')
        break
      case 'session.updated': {
        // Critical diagnostic: log the tool count XAI accepted. If our
        // session.update had tools but this comes back with none, XAI
        // is silently dropping them — that's the "rejected the tool
        // shape" failure mode, and we fall back to the hybrid
        // STT+Claude+TTS architecture.
        const acceptedTools = msg.session?.tools as RealtimeTool[] | undefined
        const n = Array.isArray(acceptedTools) ? acceptedTools.length : 0
        console.log(`[voice] session.updated — XAI accepted ${n} tool(s):`, acceptedTools?.map((t: RealtimeTool) => t.name) ?? [])
        if (n === 0) {
          setTranscript(prev => [...prev, {
            role: 'assistant',
            text: '⚠️ XAI accepted the session with 0 tools. Either we sent none, or XAI silently dropped them.',
          }])
        }
        break
      }
      case 'conversation.created':
      case 'response.created':
      case 'response.output_item.added':
      case 'response.content_part.added':
        break

      case 'response.output_audio.delta': {
        // base64 PCM16 chunk — decode and queue for playback
        if (msg.delta) queueAudioDelta(msg.delta as string)
        break
      }

      case 'response.output_audio_transcript.delta': {
        // Live caption of what the assistant is saying
        appendAssistant(msg.delta ?? '')
        break
      }
      case 'response.output_audio_transcript.done': {
        currentAssistantLineRef.current = null
        break
      }

      case 'conversation.item.input_audio_transcription.completed': {
        // The user's audio was transcribed — show what they said
        appendUser(msg.transcript ?? '')
        currentUserLineRef.current = null
        break
      }

      case 'response.function_call_arguments.done': {
        // The model finished assembling args for a tool call.
        // Shape (OpenAI-compatible): { call_id, name, arguments (JSON
        // string) }. Execute server-side, then send the result back.
        const callId = msg.call_id as string | undefined
        const name = msg.name as string | undefined
        const argsRaw = msg.arguments as string | undefined
        if (!callId || !name) break
        let parsed: Record<string, unknown> = {}
        try { parsed = argsRaw ? JSON.parse(argsRaw) : {} } catch { parsed = {} }
        // Show the tool call in the transcript so the operator can
        // watch the agent's hands.
        setTranscript(prev => [...prev, {
          role: 'assistant',
          text: `🔧 ${name}(${Object.keys(parsed).length > 0 ? Object.keys(parsed).join(', ') : ''})`,
        }])
        executeToolCall(callId, name, parsed)
        break
      }

      case 'response.done':
      case 'input_audio_buffer.speech_stopped':
      case 'input_audio_buffer.committed':
        break

      case 'error': {
        const errText = msg.error?.message ?? JSON.stringify(msg.error) ?? 'XAI realtime error'
        console.error('[voice] error event:', msg.error)
        setErrorMsg(errText)
        // Also drop in the transcript so it's visible alongside the
        // conversation rather than just in a tiny line below.
        setTranscript(prev => [...prev, { role: 'assistant', text: `❌ ${errText}` }])
        break
      }
      default:
        // Surface unrecognised events to the console with a [voice]
        // prefix so we can spot tool-call-related event names we
        // haven't wired up yet (XAI's docs are sparse on realtime
        // function-calling event types).
        console.log('[voice] unhandled event:', msg.type, msg)
    }
  }

  /**
   * Execute a tool the model invoked, then send the result back to XAI
   * and trigger a response continuation. POSTs to our authenticated
   * /api/voice/tool-call endpoint — the browser never touches Shopify
   * / CRM directly.
   *
   * Errors are stuffed into the function_call_output as a JSON error
   * shape rather than thrown — the model handles "I couldn't do that"
   * gracefully but a missing function_call_output stalls the entire
   * conversation.
   */
  async function executeToolCall(callId: string, name: string, args: Record<string, unknown>) {
    let resultJson = '{"error":"voice_tool_call_failed"}'
    try {
      if (!agentId) {
        resultJson = JSON.stringify({ error: 'no_agent_context' })
      } else {
        const res = await fetch('/api/voice/tool-call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, tool: name, args }),
        })
        if (res.ok) {
          const data = await res.json() as { result?: string; error?: string }
          resultJson = data.result ?? JSON.stringify({ error: data.error || 'no_result' })
        } else {
          resultJson = JSON.stringify({ error: `tool_endpoint_${res.status}` })
        }
      }
    } catch (err: any) {
      resultJson = JSON.stringify({ error: err?.message || 'tool_fetch_failed' })
    }

    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    // Send the function output, then ask the model to continue. Two
    // separate messages because OpenAI/XAI's realtime API expects the
    // function output to land as a conversation item, then a
    // response.create to compose the next assistant turn.
    ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: resultJson,
      },
    }))
    ws.send(JSON.stringify({ type: 'response.create' }))
  }

  function queueAudioDelta(b64: string) {
    const ctx = audioCtxRef.current
    if (!ctx) return
    const pcm16 = base64ToPCM16(b64)
    const float32 = pcm16ToFloat(pcm16)
    const buffer = ctx.createBuffer(1, float32.length, SAMPLE_RATE)
    // copyToChannel type signature wants Float32Array<ArrayBuffer>; our
    // helper returns Float32Array<ArrayBufferLike>. Copy element-wise
    // into the channel's own buffer — same cost, no cast.
    const channel = buffer.getChannelData(0)
    channel.set(float32)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    // Chain sequentially so chunks don't overlap / gap out
    const startAt = Math.max(playheadRef.current, ctx.currentTime)
    src.start(startAt)
    playheadRef.current = startAt + buffer.duration
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

function pcm16ToFloat(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / (pcm[i] < 0 ? 0x8000 : 0x7fff)
  return out
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function base64ToPCM16(b64: string): Int16Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2)
}
