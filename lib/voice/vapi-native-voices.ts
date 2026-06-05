/**
 * Vapi-native voice catalogue.
 *
 * Vapi ships a fixed set of pre-tuned voices accessible via
 * `voice: { provider: 'vapi', voiceId: '<Name>' }` on the assistant
 * config. The list is hardcoded here because the catalogue changes
 * rarely and a static list lets the wizard's voice picker populate
 * instantly with no failure modes.
 *
 * **Casing matters.** Vapi rejects lowercase voice ids with a typed
 * 400 ("voice.voiceId must be one of the following values: Clara,
 * Godfrey, Elliot, …"). The ids below are the exact capitalized
 * tokens Vapi accepts — DO NOT lowercase them in transit. The DB
 * round-tripping is normalised by a one-shot INITCAP migration; the
 * runtime adapter (`buildVapiVoiceBlock`) also defensively
 * capitalizes any pre-migration lowercase row.
 *
 * Default voice for new agents: **Elliot** — Vapi's demo "Riley"
 * assistant uses Elliot, and that's the stack we verified
 * end-to-end on Vapi's side.
 */

import type { VoiceOption } from './types'

export const VAPI_NATIVE_DEFAULT_VOICE_ID = 'Elliot'

/** All 30 Vapi-native voice ids, in the order Vapi lists them. */
export const VAPI_NATIVE_VOICE_IDS = [
  'Clara', 'Godfrey', 'Elliot', 'Savannah', 'Nico', 'Kai', 'Emma', 'Sagar',
  'Neil', 'Layla', 'Sid', 'Gustavo', 'Kylie', 'Rohan', 'Lily', 'Hana',
  'Neha', 'Cole', 'Harry', 'Paige', 'Spencer', 'Naina', 'Leah', 'Tara',
  'Jess', 'Leo', 'Dan', 'Mia', 'Zac', 'Zoe',
] as const

export type VapiNativeVoiceId = typeof VAPI_NATIVE_VOICE_IDS[number]

// Per-voice metadata. Labels are best-effort from public Vapi
// material + general voice-naming conventions. Operators can audit
// each one with the preview button — wrong-gender or wrong-accent
// reports get folded back in.
//
// `previewUrl` is intentionally NOT set on Vapi-native voices.
// Vapi doesn't expose a stable public CDN of voice samples; the
// wizard / config tab falls through to /api/voice/preview which
// proxies Vapi's TTS endpoint with a short stock phrase.
const VOICE_META: Record<VapiNativeVoiceId, { gender: 'male' | 'female'; accent: string; age: 'young' | 'middle_aged'; description: string }> = {
  Elliot:    { gender: 'male',   accent: 'american', age: 'middle_aged', description: 'Warm, conversational. The Vapi-demo default.' },
  Cole:      { gender: 'male',   accent: 'american', age: 'young',       description: 'Friendly, engaging.' },
  Harry:     { gender: 'male',   accent: 'american', age: 'middle_aged', description: 'Confident, direct.' },
  Spencer:   { gender: 'male',   accent: 'american', age: 'middle_aged', description: 'Polished, professional.' },
  Neil:      { gender: 'male',   accent: 'american', age: 'middle_aged', description: 'Steady, reassuring.' },
  Godfrey:   { gender: 'male',   accent: 'american', age: 'middle_aged', description: 'Mature, authoritative.' },
  Gustavo:   { gender: 'male',   accent: 'american', age: 'middle_aged', description: 'Warm, deep.' },
  Sid:       { gender: 'male',   accent: 'american', age: 'young',       description: 'Quick, bright.' },
  Kai:       { gender: 'male',   accent: 'american', age: 'young',       description: 'Crisp, modern.' },
  Nico:      { gender: 'male',   accent: 'american', age: 'young',       description: 'Smooth, approachable.' },
  Zac:       { gender: 'male',   accent: 'american', age: 'young',       description: 'Casual, upbeat.' },
  Dan:       { gender: 'male',   accent: 'american', age: 'young',       description: 'Easy-going.' },
  Leo:       { gender: 'male',   accent: 'american', age: 'young',       description: 'Friendly storyteller.' },
  Sagar:     { gender: 'male',   accent: 'indian',   age: 'middle_aged', description: 'Indian English, articulate.' },
  Rohan:     { gender: 'male',   accent: 'indian',   age: 'middle_aged', description: 'Indian English, polished.' },

  Clara:     { gender: 'female', accent: 'american', age: 'young',       description: 'Warm, expressive.' },
  Savannah:  { gender: 'female', accent: 'american', age: 'young',       description: 'Smooth, energetic.' },
  Emma:      { gender: 'female', accent: 'american', age: 'young',       description: 'Friendly, clear.' },
  Layla:     { gender: 'female', accent: 'american', age: 'young',       description: 'Bright, helpful.' },
  Kylie:     { gender: 'female', accent: 'american', age: 'young',       description: 'Playful, lively.' },
  Lily:      { gender: 'female', accent: 'american', age: 'young',       description: 'Soft, calming.' },
  Hana:      { gender: 'female', accent: 'american', age: 'young',       description: 'Bright, energetic.' },
  Leah:      { gender: 'female', accent: 'american', age: 'young',       description: 'Engaging, natural.' },
  Tara:      { gender: 'female', accent: 'american', age: 'young',       description: 'Smooth, professional.' },
  Jess:      { gender: 'female', accent: 'american', age: 'young',       description: 'Casual, approachable.' },
  Mia:       { gender: 'female', accent: 'american', age: 'young',       description: 'Friendly, expressive.' },
  Zoe:       { gender: 'female', accent: 'american', age: 'young',       description: 'Bright, modern.' },
  Paige:     { gender: 'female', accent: 'american', age: 'middle_aged', description: 'Reassuring, professional.' },
  Naina:     { gender: 'female', accent: 'indian',   age: 'young',       description: 'Indian English, articulate.' },
  Neha:      { gender: 'female', accent: 'indian',   age: 'middle_aged', description: 'Indian English, warm.' },
}

export const VAPI_NATIVE_VOICES: VoiceOption[] = VAPI_NATIVE_VOICE_IDS.map(id => ({
  id,
  name: id,
  language: 'en',
  labels: VOICE_META[id],
  // No static previewUrl — see comment at top.
  previewUrl: null,
}))

/**
 * Look up a Vapi-native voice by id. Case-insensitive so legacy
 * lowercase rows (Round 4 shipped 'elliot') resolve to the canonical
 * 'Elliot' entry without needing a separate migration to land first.
 */
export function getVapiNativeVoice(voiceId: string): VoiceOption | null {
  if (!voiceId) return null
  const target = voiceId.toLowerCase()
  return VAPI_NATIVE_VOICES.find(v => v.id.toLowerCase() === target) ?? null
}

/**
 * Capitalize a voice id to the canonical Vapi-native form.
 * Returns the input unchanged if not in the catalogue (lets ElevenLabs
 * ids pass through buildVapiVoiceBlock without mangling).
 */
export function canonicalVapiVoiceId(voiceId: string): string {
  const match = getVapiNativeVoice(voiceId)
  return match ? match.id : voiceId
}
