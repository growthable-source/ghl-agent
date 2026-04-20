/**
 * VoiceAdapter — provider-agnostic TTS/voice interface.
 *
 * Same pattern as CrmAdapter. Each voice provider (Vapi/ElevenLabs, XAI,
 * Deepgram, Rime, etc.) implements this surface. The UI reads
 * `capabilities` to know which sections to render; the runtime reads the
 * provider to decide how to deliver audio.
 *
 * Why: users pick *their* voice for *their* use case. The adapter
 * declares what that provider can actually do — phone? browser only?
 * TTS only? — and the UI stays honest about it.
 */

export type VoiceProviderId = 'vapi' | 'xai'

export interface VoiceProviderCapabilities {
  /** Can this provider route inbound PSTN phone calls on its own? */
  phoneCalls: boolean
  /** Can this provider power a real-time browser voice conversation? */
  realtimeBrowser: boolean
  /** Can this provider do one-shot text-to-audio synthesis? */
  ttsBatch: boolean
  /** Does this provider expose a listen-able preview for each voice? */
  voicePreview: boolean
  /** Widget voice calls (browser ↔ agent) — different from phone calls. */
  widgetVoice: boolean
}

export interface VoiceOption {
  /** Provider-specific voice ID (e.g. XAI 'eve', 11labs 'EXAVITQu4vr4xnSDxMaL'). */
  id: string
  /** Human-readable name. */
  name: string
  /** BCP-47 language code if the provider reports one. */
  language?: string
  /** Labels (gender, accent, age, etc.) when the provider exposes them. */
  labels?: Record<string, string>
  /** Direct audio URL for click-to-preview, when the provider supplies one. */
  previewUrl?: string | null
}

export interface SpeakOpts {
  language?: string
  codec?: 'mp3' | 'wav' | 'pcm' | 'mulaw' | 'alaw'
  sampleRate?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000
  bitRate?: 32000 | 64000 | 96000 | 128000 | 192000
}

export interface RealtimeToken {
  /** Ephemeral bearer token the browser uses to open the realtime WebSocket. */
  value: string
  /** Unix seconds. */
  expiresAt: number
  /** WebSocket URL the browser should connect to. */
  wsUrl: string
}

export interface VoiceAdapter {
  provider: VoiceProviderId
  capabilities: VoiceProviderCapabilities

  /** List voices offered by this provider. `search` is optional and free-form. */
  listVoices(search?: string): Promise<VoiceOption[]>

  /** Batch text-to-speech. Returns raw audio bytes. */
  speak?(text: string, voiceId: string, opts?: SpeakOpts): Promise<ArrayBuffer>

  /** Mint an ephemeral client secret for a browser to connect to this
   *  provider's realtime API. Only implemented when capabilities.realtimeBrowser. */
  getRealtimeToken?(opts?: { expiresInSeconds?: number }): Promise<RealtimeToken>
}
