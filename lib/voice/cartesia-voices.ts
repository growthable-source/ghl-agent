/**
 * Cartesia (Sonic) voice catalogue.
 *
 * Cartesia is Vapi's default voice provider as of 2026 — the most natural,
 * lowest-latency premium TTS, and (unlike a native speech-to-speech model)
 * it keeps our own Claude brain + the full tool set on every call. New
 * voice agents default here.
 *
 * Synthesis needs nothing from us beyond the voice block
 * ({ provider: 'cartesia', model, voiceId }) — Vapi owns the Cartesia
 * integration. This file is just the picker catalogue + the default.
 *
 * Voice IDs below are real Cartesia library ids (UUID form). The default
 * voice + model are env-overridable so we can re-tune without a deploy.
 */

import type { VoiceOption } from './types'

/** Sonic model. 'sonic-2' is Vapi's balanced default; 'sonic-3' / 'sonic-turbo' also valid. */
export const CARTESIA_MODEL = process.env.CARTESIA_MODEL || 'sonic-2'

/** Default voice for new agents — warm, conversational US English. Override via env. */
export const CARTESIA_DEFAULT_VOICE_ID =
  process.env.CARTESIA_DEFAULT_VOICE_ID || 'f786b574-daa5-4673-aa0c-cbe3e8534c02' // Katie
export const CARTESIA_DEFAULT_VOICE_NAME = process.env.CARTESIA_DEFAULT_VOICE_NAME || 'Katie'

/**
 * Curated, verified Cartesia voices for the picker. A small hand-picked
 * set (not the full library) so the picker is instant and every id is
 * known-good — a bad id makes Vapi reject the whole assistant. The full
 * library can be wired via the Cartesia API later if operators want more.
 */
export const CARTESIA_VOICES: VoiceOption[] = [
  { id: 'f786b574-daa5-4673-aa0c-cbe3e8534c02', name: 'Katie',   language: 'en', labels: { gender: 'female', accent: 'american', description: 'Warm, conversational. A friendly default.' }, previewUrl: null },
  { id: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4', name: 'Skylar',  language: 'en', labels: { gender: 'female', accent: 'american', description: 'Bright, upbeat, expressive.' }, previewUrl: null },
  { id: 'a5136bf9-224c-4d76-b823-52bd5efcffcc', name: 'Jameson', language: 'en', labels: { gender: 'male',   accent: 'american', description: 'Steady, confident, professional.' }, previewUrl: null },
  { id: '248be419-c632-4f23-adf1-5324ed7dbf1d', name: 'Brooke',  language: 'en', labels: { gender: 'female', accent: 'american', description: 'Calm, clear, reassuring.' }, previewUrl: null },
  { id: '2821fd0c-35c7-4adf-9c42-32e394bf85cb', name: 'Kira',    language: 'en', labels: { gender: 'female', accent: 'american', description: 'Engaging, natural prosody.' }, previewUrl: null },
  { id: '62ae83ad-4f6a-430b-af41-a9bede9286ca', name: 'Gemma',   language: 'en', labels: { gender: 'female', accent: 'british',  description: 'Polished British English.' }, previewUrl: null },
  { id: 'ef191366-f52f-447a-a398-ed8c0f2943a1', name: 'Archie',  language: 'en', labels: { gender: 'male',   accent: 'british',  description: 'Friendly British English.' }, previewUrl: null },
]

/** Case-insensitive lookup by id. */
export function getCartesiaVoice(voiceId: string): VoiceOption | null {
  if (!voiceId) return null
  const target = voiceId.toLowerCase()
  return CARTESIA_VOICES.find(v => v.id.toLowerCase() === target) ?? null
}

/** Filter the catalogue by name/description for the picker search box. */
export function filterCartesiaVoices(search?: string): VoiceOption[] {
  if (!search) return CARTESIA_VOICES
  const q = search.toLowerCase()
  return CARTESIA_VOICES.filter(
    v =>
      v.name.toLowerCase().includes(q) ||
      (v.labels?.description ?? '').toLowerCase().includes(q) ||
      (v.labels?.gender ?? '').toLowerCase().includes(q) ||
      (v.labels?.accent ?? '').toLowerCase().includes(q),
  )
}
