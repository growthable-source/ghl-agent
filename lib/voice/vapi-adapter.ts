import { searchElevenLabsVoices } from '../vapi-client'
import type { VoiceAdapter, VoiceOption, VoiceProviderCapabilities } from './types'

/**
 * Vapi adapter. Wraps the existing Vapi + ElevenLabs integration without
 * changing its runtime — `listVoices` just funnels through the existing
 * searchElevenLabsVoices helper. Phone calls stay Vapi-only.
 *
 * The realtime browser path is handled by Vapi's own @vapi-ai/web SDK,
 * so we don't mint tokens here — the browser loads the SDK directly and
 * passes the public key. getRealtimeToken is intentionally undefined;
 * the UI checks capabilities and branches.
 */
export class VapiVoiceAdapter implements VoiceAdapter {
  provider = 'vapi' as const
  capabilities: VoiceProviderCapabilities = {
    phoneCalls: true,
    realtimeBrowser: true,
    ttsBatch: true,         // indirect — via ElevenLabs passthrough in Vapi
    voicePreview: true,
    widgetVoice: true,
  }

  async listVoices(search?: string): Promise<VoiceOption[]> {
    const voices = await searchElevenLabsVoices(search)
    return voices.map(v => ({
      id: v.voice_id,
      name: v.name,
      previewUrl: v.preview_url,
      labels: v.labels,
    }))
  }
}

// ─── ElevenLabs model selection ─────────────────────────────────────
//
// ElevenLabs v3 is the new expressive model with mid-conversation
// emotion shifts and faster generation. Vapi accepts the model id on
// the assistant's voice block as `voice.model`. We default new
// assistant configs to v3 and fall back to v2.5 turbo when needed.
//
// Override per-deploy via VAPI_ELEVENLABS_MODEL — e.g. set to
// 'eleven_turbo_v2_5' if v3 isn't enabled on the account, or
// 'eleven_multilingual_v2' for international agents.

export const ELEVEN_DEFAULT_MODEL = 'eleven_v3'
export const ELEVEN_FALLBACK_MODEL = 'eleven_turbo_v2_5'

export function elevenLabsModel(): string {
  return process.env.VAPI_ELEVENLABS_MODEL || ELEVEN_DEFAULT_MODEL
}

/**
 * Build the `voice` block for a Vapi assistant config. Centralised so
 * both the outbound-call path (lib/outbound-call.ts) and the inbound
 * assistant-request webhook path (app/api/vapi/webhook/route.ts) emit
 * the same shape — including the v3 model default.
 */
export interface ElevenLabsVoiceParams {
  voiceId: string
  stability?: number | null
  similarityBoost?: number | null
  speed?: number | null
  style?: number | null
  language?: string | null
  /** Override the model id; falls back to env / v3 default. */
  model?: string | null
}

export function buildElevenLabsVoiceBlock(p: ElevenLabsVoiceParams) {
  return {
    provider: '11labs' as const,
    voiceId: p.voiceId,
    model: p.model || elevenLabsModel(),
    ...(p.stability != null && { stability: p.stability }),
    ...(p.similarityBoost != null && { similarityBoost: p.similarityBoost }),
    ...(p.speed != null && { speed: p.speed }),
    ...(p.style != null && { style: p.style }),
    ...(p.language && { language: p.language }),
  }
}
