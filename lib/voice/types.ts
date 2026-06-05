/**
 * VoiceAdapter — provider-agnostic surface.
 *
 * The platform has ONE adapter today: Vapi (lib/voice/vapi-adapter.ts).
 * The historical xAI adapter has been removed — xAI is now a TTS
 * engine selectable inside the Vapi assistant config, not a parallel
 * adapter (see lib/voice/vapi-adapter.ts:buildVapiVoiceBlock and
 * lib/voice/xai-voices.ts).
 *
 * The interface stays in place so future providers (LiveKit, etc.)
 * can be added without rewriting call sites.
 */

export type VoiceProviderId = 'vapi'

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
  /** Provider-specific voice ID (ElevenLabs cuid, Grok mnemonic like 'eve'). */
  id: string
  /** Human-readable name. */
  name: string
  /** BCP-47 language code if reported. */
  language?: string
  /** Labels (gender, accent, age, etc.) when exposed. */
  labels?: Record<string, string>
  /** Direct audio URL for click-to-preview, when the source supplies one. */
  previewUrl?: string | null
}

export interface SpeakOpts {
  language?: string
  codec?: 'mp3' | 'wav' | 'pcm' | 'mulaw' | 'alaw'
  sampleRate?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000
  bitRate?: 32000 | 64000 | 96000 | 128000 | 192000
}

export interface VoiceAdapter {
  provider: VoiceProviderId
  capabilities: VoiceProviderCapabilities
  listVoices(search?: string): Promise<VoiceOption[]>
  /** Batch text-to-speech (optional — Vapi proxies its own). */
  speak?(text: string, voiceId: string, opts?: SpeakOpts): Promise<ArrayBuffer>
}
