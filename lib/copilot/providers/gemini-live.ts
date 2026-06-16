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

export class GeminiLiveProvider implements RealtimeModelProvider {
  readonly name: CopilotModel = 'gemini-live'

  onAudioOutput?: (base64Pcm: string) => void
  onTranscript?: (turn: { role: 'user' | 'agent'; text: string; final: boolean }) => void
  onToolCall?: (call: { id: string; name: string; args: Record<string, unknown> }) => Promise<Record<string, unknown>>
  onInterrupted?: () => void
  onError?: (message: string) => void
  onEnded?: (reason: string) => void

  private ai: GoogleGenAI | null = null
  private session: LiveSessionLike | null = null
  private cfg: RealtimeProviderConfig | null = null
  private resumptionHandle: string | null = null
  private reconnects = 0
  private closing = false
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
    const vendorConfig = { ...(this.cfg.vendorConfig ?? {}) }
    if (this.resumptionHandle) {
      vendorConfig.sessionResumption = { handle: this.resumptionHandle }
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false
      void this.ai!.live
        .connect({
          model: this.cfg!.connection.vendorModelId,
          config: vendorConfig as never,
          callbacks: {
            onopen: () => {
              if (!settled) {
                settled = true
                resolve()
              }
            },
            onmessage: (msg: unknown) => this.handleMessage(msg as LiveMessage),
            onerror: (e: { message?: string }) => {
              const message = e?.message || 'realtime connection error'
              if (!settled) {
                settled = true
                reject(new Error(message))
              } else {
                this.onError?.(message)
              }
            },
            onclose: () => {
              if (!settled) {
                settled = true
                reject(new Error('connection closed during setup'))
                return
              }
              this.handleClose()
            },
          },
        })
        .then(session => {
          this.session = session as unknown as LiveSessionLike
        })
        .catch(err => {
          if (!settled) {
            settled = true
            reject(err instanceof Error ? err : new Error(String(err)))
          }
        })
    })
  }

  private handleMessage(msg: LiveMessage) {
    const sc = msg.serverContent

    if (sc?.interrupted) {
      // Barge-in: the model was cut off. Flush playback queues and
      // close out whatever partial agent speech we transcribed.
      this.onInterrupted?.()
      if (this.agentBuffer.trim()) {
        this.onTranscript?.({ role: 'agent', text: this.agentBuffer.trim(), final: true })
        this.agentBuffer = ''
      }
    }

    if (sc?.inputTranscription?.text) {
      this.userBuffer += sc.inputTranscription.text
      this.onTranscript?.({ role: 'user', text: this.userBuffer.trim(), final: false })
    }
    if (sc?.outputTranscription?.text) {
      this.agentBuffer += sc.outputTranscription.text
      this.onTranscript?.({ role: 'agent', text: this.agentBuffer.trim(), final: false })
    }

    const parts = sc?.modelTurn?.parts ?? []
    for (const part of parts) {
      if (part.inlineData?.data && (part.inlineData.mimeType ?? '').startsWith('audio/')) {
        this.onAudioOutput?.(part.inlineData.data)
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
    }

    if (msg.toolCall?.functionCalls?.length && this.onToolCall) {
      for (const fc of msg.toolCall.functionCalls) {
        const id = fc.id ?? ''
        const name = fc.name ?? ''
        void this.onToolCall({ id, name, args: fc.args ?? {} })
          .then(response => {
            this.session?.sendToolResponse({
              functionResponses: [
                {
                  id,
                  name,
                  // INTERRUPT: deliver the result as soon as it's ready —
                  // the user is usually waiting on exactly this answer.
                  response: { ...response, scheduling: 'INTERRUPT' },
                },
              ],
            })
          })
          .catch(err => {
            this.session?.sendToolResponse({
              functionResponses: [
                { id, name, response: { error: String(err), scheduling: 'WHEN_IDLE' } },
              ],
            })
          })
      }
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

  private handleClose() {
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
        this.onEnded?.('connection_lost')
      })
    } else {
      this.onEnded?.(this.resumptionHandle ? 'connection_lost' : 'connection_closed')
    }
  }

  sendAudioChunk(base64Pcm16: string): void {
    this.session?.sendRealtimeInput({
      audio: { data: base64Pcm16, mimeType: 'audio/pcm;rate=16000' },
    })
  }

  sendVideoFrame(base64Image: string, mimeType: string = 'image/jpeg'): void {
    this.session?.sendRealtimeInput({
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
    this.onInterrupted?.()
  }

  async close(): Promise<void> {
    this.closing = true
    try {
      this.session?.close()
    } catch {
      // already closed
    }
    this.session = null
  }
}
