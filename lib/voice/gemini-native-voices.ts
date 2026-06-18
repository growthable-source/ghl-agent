/**
 * Gemini native-audio prebuilt voice catalogue.
 *
 * Gemini Live exposes a fixed set of prebuilt voices selected via
 * speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName. The list is
 * hardcoded here (like vapi-native-voices.ts) because it changes rarely
 * and a static list lets the picker populate instantly with no failure
 * modes. Casing matters — Gemini expects the exact capitalized token.
 *
 * previewUrl is null: Gemini has no public one-shot TTS endpoint, so
 * operators audit each voice via the "Test voice" panel (same as the
 * Vapi-native voices). Gender/description are best-effort from Google's
 * voice material; operators verify by ear.
 */

import type { VoiceOption } from './types'

export const GEMINI_DEFAULT_VOICE_ID = 'Puck'

export const GEMINI_NATIVE_VOICE_IDS = [
  'Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr',
] as const

export type GeminiNativeVoiceId = typeof GEMINI_NATIVE_VOICE_IDS[number]

const VOICE_META: Record<GeminiNativeVoiceId, { gender: 'male' | 'female'; description: string }> = {
  Puck:   { gender: 'male',   description: 'Upbeat, energetic. A friendly default.' },
  Charon: { gender: 'male',   description: 'Deep, measured, authoritative.' },
  Kore:   { gender: 'female', description: 'Warm, clear, professional.' },
  Fenrir: { gender: 'male',   description: 'Bright, confident, direct.' },
  Aoede:  { gender: 'female', description: 'Smooth, expressive, natural.' },
  Leda:   { gender: 'female', description: 'Soft, calm, reassuring.' },
  Orus:   { gender: 'male',   description: 'Steady, grounded, even-toned.' },
  Zephyr: { gender: 'female', description: 'Light, breezy, approachable.' },
}

export const GEMINI_NATIVE_VOICES: VoiceOption[] = GEMINI_NATIVE_VOICE_IDS.map(id => ({
  id,
  name: id,
  language: 'en',
  labels: VOICE_META[id],
  previewUrl: null,
}))

/** Case-insensitive lookup; returns null for unknown / empty ids. */
export function getGeminiVoice(voiceId: string): VoiceOption | null {
  if (!voiceId) return null
  const target = voiceId.toLowerCase()
  return GEMINI_NATIVE_VOICES.find(v => v.id.toLowerCase() === target) ?? null
}
