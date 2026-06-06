import { searchElevenLabsVoices } from '../vapi-client'
import { canonicalVapiVoiceId } from './vapi-native-voices'
import type { VoiceOption } from './types'

/**
 * Vapi adapter. Vapi handles the phone bridge + the @vapi-ai/web
 * browser SDK and accepts multiple TTS engines (vapi-native, 11labs,
 * openai, cartesia, deepgram, …) on the same assistant config. Engine
 * choice is a property of the assistant config's voice block, NOT a
 * separate provider.
 *
 * listVoices() returns the ElevenLabs catalogue (5000+ voices) since
 * that's the engine with the broadest selection. The Vapi-native
 * catalogue (Elliot et al.) is hardcoded in lib/voice/vapi-native-voices.ts
 * and surfaces in the wizard under its own tab — same Vapi pipeline
 * at runtime.
 */
export class VapiVoiceAdapter {
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
// field. Two engines we support:
//
//   'vapi'       → emits  { provider: 'vapi', voiceId, language? }
//                  Vapi-native voices (Elliot, Cole, Harry, Hana, Neha,
//                  Paige, Rohan, Spencer). Pre-tuned by Vapi — no
//                  tuning fields. THIS IS THE NEW DEFAULT.
//   'elevenlabs' → emits  { provider: '11labs', voiceId, model, ...tuning }
//                  5000+ ElevenLabs catalogue with full tuning. Kept
//                  as the alternative for operators who want a
//                  specific ElevenLabs voice.
//
// Engine identity lives on VapiConfig.ttsProvider. Post-migration
// (Phase D SQL) values are 'vapi' or 'elevenlabs' — no more 'xai'
// rows. Unknown values fall back to 'vapi' (the new default).

export type VoiceEngine = 'elevenlabs' | 'vapi'

/** Map the persisted VapiConfig.ttsProvider field to a VoiceEngine. */
export function resolveVoiceEngine(ttsProvider?: string | null): VoiceEngine {
  if (ttsProvider === 'elevenlabs' || ttsProvider === '11labs') return 'elevenlabs'
  // 'vapi' (new default), legacy 'xai', null, undefined → 'vapi'.
  // Legacy 'xai' rows should never reach here after Phase D SQL runs
  // (they're rewritten to 'vapi'/'elliot'); this fallback covers any
  // that slip through.
  return 'vapi'
}

// Default ElevenLabs model. We use eleven_turbo_v2_5 — Vapi documents
// this as the recommended model for phone calls (low latency, GA
// quality, no expressive-pause artefacts that the alpha eleven_v3
// produces on a narrow-band phone codec). eleven_v3 is the newest
// expressive model but in practice phone calls using it sound worse,
// not better — the expressive emotion shifts get mangled by the
// phone bandwidth and the longer per-utterance generation time
// adds noticeable conversational lag.
//
// Operators who want to opt into v3 (or any other model id) can set
// VAPI_ELEVENLABS_MODEL on the deploy without touching code.
export const ELEVEN_DEFAULT_MODEL = 'eleven_turbo_v2_5'
export const ELEVEN_LEGACY_V3 = 'eleven_v3'
export function elevenLabsModel(): string {
  return process.env.VAPI_ELEVENLABS_MODEL || ELEVEN_DEFAULT_MODEL
}

export interface VapiVoiceParams {
  /** Which TTS engine Vapi should route to. Derived from VapiConfig.ttsProvider. */
  engine?: VoiceEngine | null
  voiceId: string
  /** Override the ElevenLabs model id. Ignored for the vapi engine. */
  model?: string | null
  /** ElevenLabs tuning fields — ignored for the vapi engine. */
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
  const engine = p.engine ?? 'vapi'

  if (engine === 'elevenlabs') {
    // ElevenLabs path — full shape with tuning + model. Kept for
    // operators who want a specific ElevenLabs voice; new agents
    // default to the Vapi-native engine below.
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

  // Vapi-native (default). Just provider + voiceId — Vapi rejects
  // extra params on the 'vapi' provider (it's pre-tuned). Matches
  // the demo Riley agent's voice block: { provider: 'vapi', voiceId: 'Elliot' }.
  //
  // Capitalize the voiceId defensively. Vapi rejects lowercase ids
  // with a typed 400. Pre-Round-5 DB rows may still hold 'elliot' from
  // the Round 4 SQL; `canonicalVapiVoiceId` maps that back to the
  // catalogue's canonical 'Elliot' so the assistant payload is always
  // accepted, even before / mid-migration. Non-catalogue ids pass
  // through unchanged.
  return {
    provider: 'vapi' as const,
    voiceId: canonicalVapiVoiceId(p.voiceId),
    ...(p.language && { language: p.language }),
  }
}
