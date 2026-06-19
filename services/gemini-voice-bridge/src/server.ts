import { createServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { loadConfig } from './config.js'
import { signBridgeRequest } from './sign.js'
import { muLawDecode, muLawEncode, resampleLinear } from './audio.js'
import { parseTwilioFrame, mediaFrame, clearFrame } from './twilio-stream.js'
import { connectGemini, type GeminiLink, type GeminiVoiceSession } from './gemini.js'

const cfg = loadConfig()

const server = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }
  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({ server, path: '/call' })

interface CallState {
  streamSid: string
  callSid: string
  agentId: string | null
  locationId: string | null
  from: string
  to: string
  startedAt: number
  transcript: string[]
  gemini: GeminiLink | null
  closed: boolean
}

async function postSigned(path: string, payload: unknown): Promise<Response> {
  const body = JSON.stringify(payload)
  return fetch(`${cfg.appUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Voice-Signature': signBridgeRequest(cfg.signingSecret, body) },
    body,
  })
}

wss.on('connection', (twilioWs: WebSocket) => {
  const state: CallState = {
    streamSid: '',
    callSid: '',
    agentId: null,
    locationId: null,
    from: '',
    to: '',
    startedAt: Date.now(),
    transcript: [],
    gemini: null,
    closed: false,
  }

  // Buffer caller audio (μ-law 8k) that arrives before Gemini is ready.
  const pendingInbound: Int16Array[] = []

  const sendToTwilio = (pcm24k: Int16Array) => {
    if (state.closed) return
    const pcm8k = resampleLinear(pcm24k, 24000, 8000)
    const ulaw = muLawEncode(pcm8k)
    twilioWs.send(mediaFrame(state.streamSid, ulaw.toString('base64')))
  }

  const flushTwilio = () => {
    if (!state.closed && state.streamSid) twilioWs.send(clearFrame(state.streamSid))
  }

  const startGemini = async (session: GeminiVoiceSession) => {
    state.gemini = await connectGemini(cfg.geminiApiKey, session, {
      onAudio: sendToTwilio,
      onInterrupted: flushTwilio,
      onTranscript: (role, text) => state.transcript.push(`${role === 'user' ? 'Caller' : 'Agent'}: ${text}`),
      onClose: () => endCall('gemini-closed'),
      onToolCall: async (calls) => {
        for (const call of calls) {
          try {
            const res = await postSigned('/api/voice/gemini/tool', {
              agentId: state.agentId,
              name: call.name,
              args: call.args,
            })
            const result = (res.ok ? await res.json() : { error: 'tool failed' }) as Record<string, unknown>
            state.gemini?.sendToolResponse([{ id: call.id, name: call.name, response: result }])
          } catch {
            state.gemini?.sendToolResponse([{ id: call.id, name: call.name, response: { error: 'tool error' } }])
          }
        }
      },
    })
    // Drain anything the caller said while we were connecting.
    for (const chunk of pendingInbound) state.gemini.sendAudio(chunk)
    pendingInbound.length = 0
  }

  const endCall = async (reason: string) => {
    if (state.closed) return
    state.closed = true
    try { state.gemini?.close() } catch {}
    try { twilioWs.close() } catch {}
    if (state.agentId && state.locationId) {
      const durationSecs = Math.round((Date.now() - state.startedAt) / 1000)
      try {
        await postSigned('/api/voice/gemini/call-ended', {
          agentId: state.agentId,
          locationId: state.locationId,
          callSid: state.callSid,
          from: state.from,
          to: state.to,
          durationSecs,
          transcript: state.transcript.join('\n'),
          endedReason: reason,
        })
      } catch {
        // Best-effort; a dropped sink call must not crash the process.
      }
    }
  }

  twilioWs.on('message', async (data) => {
    const frame = parseTwilioFrame(data.toString())
    if (!frame) return

    if (frame.event === 'start') {
      state.streamSid = frame.streamSid
      state.callSid = frame.callSid
      const signedParams = frame.params['p'] ?? ''
      try {
        const res = await postSigned('/api/voice/gemini/session-config', { params: signedParams })
        if (!res.ok) return endCall('session-config-failed')
        const cfgBody = (await res.json()) as {
          session: GeminiVoiceSession
          agentId: string
          locationId: string
        }
        state.agentId = cfgBody.agentId
        state.locationId = cfgBody.locationId
        await startGemini(cfgBody.session)
      } catch {
        return endCall('session-config-error')
      }
      return
    }

    if (frame.event === 'media') {
      // μ-law 8k → PCM16 8k → 16k → Gemini.
      const pcm8k = muLawDecode(Buffer.from(frame.payload, 'base64'))
      const pcm16k = resampleLinear(pcm8k, 8000, 16000)
      if (state.gemini) state.gemini.sendAudio(pcm16k)
      else pendingInbound.push(pcm16k)
      return
    }

    if (frame.event === 'stop') {
      await endCall('caller-hangup')
      return
    }
  })

  twilioWs.on('close', () => endCall('ws-close'))
  twilioWs.on('error', () => endCall('ws-error'))

  // Hard ceiling guard: never let a wedged call outlive its budget.
  setTimeout(() => endCall('max-duration'), 11 * 60 * 1000)
})

server.listen(cfg.port, () => {
  // eslint-disable-next-line no-console
  console.log(`gemini-voice-bridge listening on :${cfg.port}`)
})
