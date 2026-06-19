import { GoogleGenAI } from '@google/genai'

/** Subset of the session-config response the bridge consumes. */
export interface GeminiVoiceSession {
  liveConfig: Record<string, unknown>
  vendorModelId: string
  voiceName: string | null
  maxSessionSecs: number
}

export interface GeminiCallbacks {
  /** PCM16 24 kHz mono audio chunk from the model. */
  onAudio: (pcm24k: Int16Array) => void
  /** Model asked to call a tool. */
  onToolCall: (calls: Array<{ id?: string; name: string; args: Record<string, unknown> }>) => void
  /** Barge-in: caller spoke over the model; flush playback. */
  onInterrupted: () => void
  /** Incremental transcript fragments (role = 'user' | 'model'). */
  onTranscript: (role: 'user' | 'model', text: string) => void
  onClose: () => void
}

export interface GeminiLink {
  /** Send PCM16 16 kHz mono caller audio to the model. */
  sendAudio: (pcm16k: Int16Array) => void
  sendToolResponse: (responses: Array<{ id?: string; name: string; response: Record<string, unknown> }>) => void
  close: () => void
}

function base64ToInt16(b64: string): Int16Array {
  const buf = Buffer.from(b64, 'base64')
  // PCM16 little-endian.
  return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2)).slice()
}

function int16ToBase64(pcm: Int16Array): string {
  return Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength).toString('base64')
}

/**
 * Open a Gemini Live session from a locked GeminiVoiceSession. Uses the
 * full server-side GEMINI_API_KEY (the bridge is trusted infra — no
 * ephemeral token needed here). config = session.liveConfig, which
 * already carries responseModalities, systemInstruction, tools,
 * transcription, and sessionResumption from buildGeminiVoiceSession.
 */
export async function connectGemini(
  apiKey: string,
  session: GeminiVoiceSession,
  cb: GeminiCallbacks,
): Promise<GeminiLink> {
  const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1alpha' } })

  const live = await ai.live.connect({
    model: session.vendorModelId,
    config: session.liveConfig as Record<string, unknown>,
    callbacks: {
      onmessage: (msg: any) => {
        const sc = msg?.serverContent
        if (sc?.interrupted) cb.onInterrupted()
        const parts = sc?.modelTurn?.parts ?? []
        for (const part of parts) {
          const inline = part?.inlineData
          if (inline?.data && String(inline.mimeType ?? '').startsWith('audio/')) {
            cb.onAudio(base64ToInt16(inline.data))
          }
        }
        if (sc?.inputTranscription?.text) cb.onTranscript('user', sc.inputTranscription.text)
        if (sc?.outputTranscription?.text) cb.onTranscript('model', sc.outputTranscription.text)
        const calls = msg?.toolCall?.functionCalls
        if (Array.isArray(calls) && calls.length) {
          cb.onToolCall(
            calls.map((c: any) => ({ id: c.id, name: String(c.name), args: c.args ?? {} })),
          )
        }
      },
      onerror: () => cb.onClose(),
      onclose: () => cb.onClose(),
    },
  })

  return {
    sendAudio: (pcm16k: Int16Array) => {
      live.sendRealtimeInput({
        audio: { data: int16ToBase64(pcm16k), mimeType: 'audio/pcm;rate=16000' },
      })
    },
    sendToolResponse: (responses) => {
      live.sendToolResponse({
        functionResponses: responses.map((r) => ({ id: r.id, name: r.name, response: r.response })),
      })
    },
    close: () => live.close(),
  }
}
