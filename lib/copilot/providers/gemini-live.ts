/**
 * GeminiLiveProvider — RealtimeModelProvider implementation over the
 * Gemini Live API (browser-direct WebSocket, ephemeral token auth).
 *
 * The session UI never touches @google/genai; everything vendor-
 * specific lives here behind the RealtimeModelProvider interface so
 * a GptRealtimeProvider can slot in without UI changes (spec G3).
 *
 * Connection lifecycle quirks this class absorbs:
 *   - The Live API WS connection drops around the 10-minute mark
 *     (and sends `goAway` shortly before). We hold the latest
 *     sessionResumption handle and transparently reconnect — the
 *     ephemeral token is minted with multiple uses for exactly this.
 *   - Audio+video sessions only survive past ~2 minutes because the
 *     server locked contextWindowCompression into the token config.
 *   - Transcription arrives as incremental fragments; we accumulate
 *     per role and emit a final turn on turnComplete / interruption.
 */

import { GoogleGenAI } from '@google/genai'
import type {
  CopilotModel,
  RealtimeModelProvider,
  RealtimeProviderConfig,
} from '../types'
import { RollingPreActivationAudio, splitSelfEcho } from '../turn-lifecycle'

/** Minimal structural view of LiveServerMessage — we only read these
 *  fields, and tolerating absence beats pinning the SDK's full type. */
interface LiveMessage {
  setupComplete?: unknown
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> }
    turnComplete?: boolean
    interrupted?: boolean
    inputTranscription?: { text?: string }
    outputTranscription?: { text?: string }
  }
  toolCall?: {
    functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>
  }
  sessionResumptionUpdate?: { resumable?: boolean; newHandle?: string }
  goAway?: { timeLeft?: string }
}

interface LiveSessionLike {
  sendRealtimeInput(input: Record<string, unknown>): void
  sendClientContent(input: Record<string, unknown>): void
  sendToolResponse(input: Record<string, unknown>): void
  close(): void
}

const MAX_RECONNECTS = 5
const SETUP_TIMEOUT_MS = 20_000
/** Two seconds of 16 kHz mono PCM16. Bounds memory while preserving the
 *  beginning of speech that lands during setup or a resumable reconnect. */
const MAX_PENDING_AUDIO_BYTES = 16_000 * 2 * 2
const SELF_ECHO_WINDOW_MS = 2_000

export class GeminiLiveProvider implements RealtimeModelProvider {
  readonly name: CopilotModel = 'gemini-live'

  onAudioOutput?: (base64Pcm: string, meta: { responseEpoch: number }) => void
  onTranscript?: (turn: { role: 'user' | 'agent'; text: string; final: boolean }) => void
  onToolCall?: (call: { id: string; name: string; args: Record<string, unknown> }) => Promise<Record<string, unknown>>
  onInterrupted?: (responseEpoch: number) => void
  onTurnComplete?: () => void
  onSelfEchoSuppressed?: () => void
  onError?: (message: string) => void
  onEnded?: (reason: string) => void

  private ai: GoogleGenAI | null = null
  private session: LiveSessionLike | null = null
  private cfg: RealtimeProviderConfig | null = null
  private resumptionHandle: string | null = null
  private reconnects = 0
  private closing = false
  private setupComplete = false
  private connectionEpoch = 0
  private sessionsByEpoch = new Map<number, LiveSessionLike>()
  private pendingSetupCancel: (() => void) | null = null
  private pendingAudio = new RollingPreActivationAudio(MAX_PENDING_AUDIO_BYTES)
  private pendingVideo: { data: string; mimeType: string } | null = null
  private pendingToolResponses = new Map<string, Record<string, unknown>>()
  private responseEpoch = 0
  private activeResponseEpoch = 0
  private responseActive = false
  private awaitingFreshInputAfterInterrupt = false
  private freshInputAfterInterrupt = false
  private serverInterruptedForInput = false
  private recentAgentOutput = ''
  private lastAgentOutputAt = 0
  private userBuffer = ''
  private agentBuffer = ''

  async connect(cfg: RealtimeProviderConfig): Promise<void> {
    this.cfg = cfg
    this.ai = new GoogleGenAI({
      apiKey: cfg.connection.token,
      httpOptions: { apiVersion: 'v1alpha' },
    })
    await this.openSession()
  }

  private async openSession(): Promise<void> {
    if (!this.ai || !this.cfg) throw new Error('connect() not called')
    const epoch = ++this.connectionEpoch
    this.setupComplete = false
    const vendorConfig = { ...(this.cfg.vendorConfig ?? {}) }
    if (this.resumptionHandle) {
      vendorConfig.sessionResumption = { handle: this.resumptionHandle }
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false
      let sdkSessionReady = false
      let liveSetupReady = false
      let openedSession: LiveSessionLike | null = null
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          try {
            openedSession?.close()
          } catch {
            // already closed
          }
          this.sessionsByEpoch.delete(epoch)
          this.pendingSetupCancel = null
          if (this.connectionEpoch === epoch) this.connectionEpoch++
          reject(new Error('realtime setup timed out'))
        }
      }, SETUP_TIMEOUT_MS)
      const settleReady = () => {
        if (settled || !sdkSessionReady || !liveSetupReady || this.connectionEpoch !== epoch) return
        settled = true
        clearTimeout(timeout)
        this.session = openedSession
        this.setupComplete = true
        this.pendingSetupCancel = null
        this.flushPendingAudio()
        this.flushPendingVideo()
        this.flushPendingToolResponses()
        resolve()
      }
      const rejectCurrent = (error: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        try {
          openedSession?.close()
        } catch {
          // already closed
        }
        this.sessionsByEpoch.delete(epoch)
        this.pendingSetupCancel = null
        if (this.connectionEpoch === epoch) this.connectionEpoch++
        reject(error)
      }
      this.pendingSetupCancel = () => rejectCurrent(new Error('realtime connection closed'))
      void this.ai!.live
        .connect({
          model: this.cfg!.connection.vendorModelId,
          config: vendorConfig as never,
          callbacks: {
            onopen: () => {
              // WebSocket open is not session readiness. Audio is held until
              // both the SDK session and Live API setupComplete are present.
            },
            onmessage: (msg: unknown) => {
              if (this.connectionEpoch !== epoch || this.closing) return
              const liveMessage = msg as LiveMessage
              if (liveMessage.setupComplete) {
                liveSetupReady = true
                settleReady()
              }
              this.handleMessage(liveMessage, epoch)
            },
            onerror: (e: { message?: string }) => {
              if (this.connectionEpoch !== epoch || this.closing) return
              const message = e?.message || 'realtime connection error'
              if (!settled) {
                rejectCurrent(new Error(message))
              } else {
                this.onError?.(message)
              }
            },
            onclose: () => {
              if (this.connectionEpoch !== epoch) return
              if (!settled) {
                rejectCurrent(new Error('connection closed during setup'))
                return
              }
              this.handleClose(epoch, openedSession)
            },
          },
        })
        .then(session => {
          openedSession = session as unknown as LiveSessionLike
          this.sessionsByEpoch.set(epoch, openedSession)
          if (this.connectionEpoch !== epoch || this.closing) {
            try {
              openedSession.close()
            } catch {
              // already closed
            }
            this.sessionsByEpoch.delete(epoch)
            return
          }
          sdkSessionReady = true
          settleReady()
        })
        .catch(err => {
          rejectCurrent(err instanceof Error ? err : new Error(String(err)))
        })
    })
  }

  private handleMessage(msg: LiveMessage, connectionEpoch: number) {
    if (connectionEpoch !== this.connectionEpoch || this.closing) return
    const sc = msg.serverContent

    if (sc?.interrupted) {
      // Barge-in: the model was cut off. Flush playback queues and
      // close out whatever partial agent speech we transcribed.
      const canceledEpoch = this.activeResponseEpoch
      this.onInterrupted?.(canceledEpoch)
      this.responseActive = false
      this.awaitingFreshInputAfterInterrupt = true
      this.freshInputAfterInterrupt = false
      this.serverInterruptedForInput = true
      if (this.agentBuffer.trim()) {
        this.onTranscript?.({ role: 'agent', text: this.agentBuffer.trim(), final: true })
        this.agentBuffer = ''
      }
    }

    if (sc?.inputTranscription?.text) {
      const fragment = sc.inputTranscription.text
      this.freshInputAfterInterrupt = this.freshInputAfterInterrupt || this.awaitingFreshInputAfterInterrupt
      const candidate = `${this.userBuffer}${fragment}`
      const withinEchoWindow = Date.now() - this.lastAgentOutputAt <= SELF_ECHO_WINDOW_MS
      const split = withinEchoWindow
        ? splitSelfEcho(candidate, this.recentAgentOutput, this.serverInterruptedForInput)
        : { echoDetected: false, suffix: candidate }
      if (split.echoDetected) {
        this.onSelfEchoSuppressed?.()
        this.userBuffer = split.suffix
      } else {
        this.userBuffer = candidate
      }
      if (this.userBuffer.trim()) {
        this.onTranscript?.({ role: 'user', text: this.userBuffer.trim(), final: false })
      }
    }
    if (sc?.outputTranscription?.text) {
      this.agentBuffer += sc.outputTranscription.text
      this.recentAgentOutput = this.agentBuffer.trim()
      this.lastAgentOutputAt = Date.now()
      this.onTranscript?.({ role: 'agent', text: this.agentBuffer.trim(), final: false })
    }

    // Start tool tracking before processing audio in the same server message,
    // so acknowledgement/filler audio cannot become the measured answer.
    if (msg.toolCall?.functionCalls?.length && this.onToolCall) {
      for (const fc of msg.toolCall.functionCalls) this.executeToolCall(fc)
    }

    const parts = sc?.modelTurn?.parts ?? []
    for (const part of parts) {
      if (part.inlineData?.data && (part.inlineData.mimeType ?? '').startsWith('audio/')) {
        if (this.awaitingFreshInputAfterInterrupt && !this.freshInputAfterInterrupt) continue
        if (!this.responseActive) {
          this.activeResponseEpoch = ++this.responseEpoch
          this.responseActive = true
          if (this.awaitingFreshInputAfterInterrupt) {
            this.awaitingFreshInputAfterInterrupt = false
            this.freshInputAfterInterrupt = false
          }
        }
        this.onAudioOutput?.(part.inlineData.data, { responseEpoch: this.activeResponseEpoch })
      }
    }

    if (sc?.turnComplete) {
      if (this.userBuffer.trim()) {
        this.onTranscript?.({ role: 'user', text: this.userBuffer.trim(), final: true })
        this.userBuffer = ''
      }
      if (this.agentBuffer.trim()) {
        this.onTranscript?.({ role: 'agent', text: this.agentBuffer.trim(), final: true })
        this.agentBuffer = ''
      }
      this.responseActive = false
      this.serverInterruptedForInput = false
      this.onTurnComplete?.()
    }

    if (msg.sessionResumptionUpdate?.resumable && msg.sessionResumptionUpdate.newHandle) {
      this.resumptionHandle = msg.sessionResumptionUpdate.newHandle
    }

    if (msg.goAway) {
      // Server is about to drop the connection — nothing to do
      // proactively; handleClose() reconnects with the handle.
      console.info('[Copilot] goAway received, timeLeft:', msg.goAway.timeLeft)
    }
  }

  private executeToolCall(
    fc: { id?: string; name?: string; args?: Record<string, unknown> },
  ): void {
    if (!this.onToolCall) return
    const id = fc.id ?? ''
    const name = fc.name ?? ''
    void this.onToolCall({ id, name, args: fc.args ?? {} })
      .then(response => {
        this.deliverOrQueueToolResponse(id, {
          functionResponses: [
            {
              id,
              name,
              response: { ...response, scheduling: 'INTERRUPT' },
            },
          ],
        })
      })
      .catch(err => {
        this.deliverOrQueueToolResponse(id, {
          functionResponses: [
            { id, name, response: { error: String(err), scheduling: 'WHEN_IDLE' } },
          ],
        })
      })
  }

  private deliverOrQueueToolResponse(id: string, payload: Record<string, unknown>): void {
    if (this.closing) return
    if (this.session && this.setupComplete) {
      this.session.sendToolResponse(payload)
      return
    }
    this.pendingToolResponses.set(id, payload)
  }

  private handleClose(connectionEpoch: number, closedSession: LiveSessionLike | null) {
    if (connectionEpoch !== this.connectionEpoch) return
    this.connectionEpoch++
    this.sessionsByEpoch.delete(connectionEpoch)
    this.setupComplete = false
    if (this.session === closedSession) this.session = null
    if (this.closing) {
      this.onEnded?.('user_ended')
      return
    }
    // Unexpected close. Reconnect with the resumption handle if we
    // have one; otherwise the session context is gone — end honestly
    // rather than silently starting a fresh, amnesiac session.
    if (this.resumptionHandle && this.reconnects < MAX_RECONNECTS) {
      this.reconnects++
      void this.openSession().catch(err => {
        console.error('[Copilot] reconnect failed:', err)
        this.pendingToolResponses.clear()
        this.onEnded?.('connection_lost')
      })
    } else {
      this.pendingToolResponses.clear()
      this.onEnded?.(this.resumptionHandle ? 'connection_lost' : 'connection_closed')
    }
  }

  sendAudioChunk(base64Pcm16: string): void {
    if (!this.session || !this.setupComplete) {
      this.queuePendingAudio(base64Pcm16)
      return
    }
    this.sendAudioNow(base64Pcm16)
  }

  sendVideoFrame(base64Image: string, mimeType: string = 'image/jpeg'): void {
    if (!this.session || !this.setupComplete) {
      this.pendingVideo = { data: base64Image, mimeType }
      return
    }
    this.session.sendRealtimeInput({
      video: { data: base64Image, mimeType },
    })
  }

  injectContext(text: string): void {
    // turnComplete:false appends context without forcing a response —
    // the async grounding path from P0-5.
    this.session?.sendClientContent({
      turns: [{ role: 'user', parts: [{ text: `[context update — do not respond directly] ${text}` }] }],
      turnComplete: false,
    })
  }

  nudge(text: string): void {
    // turnComplete:true forces the model to take a turn now — this is
    // the proactive trigger that turns a screen-change or idle tick
    // into speech. The model still chooses to stay silent when the
    // cue says nothing is worth saying. The newest video frame has
    // already been pushed over the same socket, so the model grounds
    // this turn on the current screen.
    this.session?.sendClientContent({
      turns: [{ role: 'user', parts: [{ text }] }],
      turnComplete: true,
    })
  }

  interrupt(): void {
    // Gemini Live runs server-side VAD on the mic stream, so true
    // barge-in happens automatically when the user speaks. A manual
    // interrupt is purely local: stop playback now.
    this.onInterrupted?.(this.activeResponseEpoch)
  }

  async close(): Promise<void> {
    this.closing = true
    this.pendingSetupCancel?.()
    this.connectionEpoch++
    this.session = null
    for (const session of this.sessionsByEpoch.values()) {
      try {
        session.close()
      } catch {
        // already closed
      }
    }
    this.sessionsByEpoch.clear()
    this.setupComplete = false
    this.pendingAudio.clear()
    this.pendingVideo = null
    this.pendingToolResponses.clear()
  }

  private sendAudioNow(data: string): void {
    this.session?.sendRealtimeInput({
      audio: { data, mimeType: 'audio/pcm;rate=16000' },
    })
  }

  private queuePendingAudio(data: string): void {
    this.pendingAudio.push(data)
  }

  private flushPendingAudio(): void {
    if (!this.session || !this.setupComplete) return
    for (const chunk of this.pendingAudio.drain()) this.sendAudioNow(chunk)
  }

  private flushPendingVideo(): void {
    if (!this.session || !this.setupComplete || !this.pendingVideo) return
    const frame = this.pendingVideo
    this.pendingVideo = null
    this.session.sendRealtimeInput({
      video: { data: frame.data, mimeType: frame.mimeType },
    })
  }

  private flushPendingToolResponses(): void {
    if (!this.session || !this.setupComplete) return
    const pending = [...this.pendingToolResponses.values()]
    this.pendingToolResponses.clear()
    for (const payload of pending) this.session.sendToolResponse(payload)
  }
}
