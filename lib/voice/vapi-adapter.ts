import { searchElevenLabsVoices } from '../vapi-client'
import type { VoiceAdapter, VoiceOption, VoiceProviderCapabilities } from './types'

/**
 * Vapi adapter. Vapi is the ONLY voice-provider abstraction we keep —
 * it owns the phone bridge, owns the @vapi-ai/web browser SDK, and
 * accepts multiple TTS engines (11labs, xai, openai, cartesia, …) on
 * the same assistant config. Engine choice is a property of the
 * assistant config's voice block, NOT a separate provider.
 *
 * listVoices() defaults to ElevenLabs since that's the engine with
 * 5000+ voices and the natural default. Grok voices are listed by
 * lib/voice/xai-voices.ts and surface in the wizard under their own
 * tab — same Vapi pipeline at runtime.
 */
export class VapiVoiceAdapter implements VoiceAdapter {
  provider = 'vapi' as const
  capabilities: VoiceProviderCapabilities = {
    phoneCalls: true,
    realtimeBrowser: true,
    ttsBatch: true,
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

// ─── Engine selection + voice block builder ─────────────────────────
//
// Vapi accepts a voice provider on the assistant config's `voice.provider`
// field. Two engines we support today:
//
//   'elevenlabs' → emits  { provider: '11labs', voiceId, model, ...tuning }
//                  ElevenLabs v3 by default; full tuning fields apply.
//   'xai'        → emits  { provider: 'xai',    voiceId, language? }
//                  Grok voices via Vapi's xAI partner integration.
//                  No ElevenLabs-specific tuning fields (model/stability/
//                  similarityBoost/speed/style); Vapi rejects calls with
//                  extra params on non-11labs providers.
//
// Engine identity lives on VapiConfig.ttsProvider (legacy column;
// values 'vapi'/'elevenlabs' both map to 'elevenlabs', 'xai' maps to
// 'xai'). Unknown values fall back to 'elevenlabs' so existing rows
// keep working.

export type VoiceEngine = 'elevenlabs' | 'xai'

/** Map the persisted VapiConfig.ttsProvider field to a VoiceEngine. */
export function resolveVoiceEngine(ttsProvider?: string | null): VoiceEngine {
  if (ttsProvider === 'xai') return 'xai'
  // 'vapi' (legacy), 'elevenlabs', '11labs', null, undefined → elevenlabs
  return 'elevenlabs'
}

// ElevenLabs v3 expressive model — default for the elevenlabs engine.
// Override per-deploy via VAPI_ELEVENLABS_MODEL (e.g. eleven_turbo_v2_5
// for accounts that don't have v3 enabled).
export const ELEVEN_DEFAULT_MODEL = 'eleven_v3'
export const ELEVEN_FALLBACK_MODEL = 'eleven_turbo_v2_5'
export function elevenLabsModel(): string {
  return process.env.VAPI_ELEVENLABS_MODEL || ELEVEN_DEFAULT_MODEL
}

// Vapi's provider string for xAI. The AI Overview that announced the
// partnership uses 'xai'; if Vapi later renames to 'x-ai' or 'grok',
// override here without touching the call sites.
export function xaiProviderString(): string {
  return process.env.VAPI_XAI_PROVIDER || 'xai'
}

export interface VapiVoiceParams {
  /** Which TTS engine Vapi should route to. Derived from VapiConfig.ttsProvider. */
  engine?: VoiceEngine | null
  voiceId: string
  /** Override the ElevenLabs model id. Ignored for the xai engine. */
  model?: string | null
  /** ElevenLabs tuning fields — ignored for the xai engine. */
  stability?: number | null
  similarityBoost?: number | null
  speed?: number | null
  style?: number | null
  /** BCP-47 language tag — passed through for both engines when set. */
  language?: string | null
}

/**
 * Build the `voice` block for a Vapi assistant config. Centralised so
 * every call site (outbound, inbound assistant-request, widget) emits
 * the same shape per engine. Adding a new engine adds one branch here
 * and is invisible to call sites.
 */
export function buildVapiVoiceBlock(p: VapiVoiceParams): Record<string, unknown> {
  const engine = p.engine ?? 'elevenlabs'

  if (engine === 'xai') {
    // xAI partner integration via Vapi. Only the bare minimum — Vapi
    // rejects assistant configs with extra params on non-11labs
    // providers (the elevenlabs-shaped tuning fields are dropped here
    // even if the agent's VapiConfig carries leftover values from a
    // previous ElevenLabs config).
    return {
      provider: xaiProviderString(),
      voiceId: p.voiceId,
      ...(p.language && { language: p.language }),
    }
  }

  // ElevenLabs (default). Full shape with tuning + model.
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

/**
 * Back-compat alias. Old callers in lib/outbound-call.ts and
 * app/api/vapi/webhook/route.ts referenced buildElevenLabsVoiceBlock
 * directly; the new code uses buildVapiVoiceBlock with an explicit
 * engine. The alias forces 'elevenlabs' so an un-migrated caller
 * doesn't accidentally regress to the xai engine.
 *
 * @deprecated use buildVapiVoiceBlock({ engine, ...params }) instead
 */
export function buildElevenLabsVoiceBlock(p: Omit<VapiVoiceParams, 'engine'>) {
  return buildVapiVoiceBlock({ ...p, engine: 'elevenlabs' })
}
