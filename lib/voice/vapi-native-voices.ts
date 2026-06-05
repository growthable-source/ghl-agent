/**
 * Vapi-native voice catalogue.
 *
 * Vapi ships a small set of pre-tuned voices accessible via
 * `voice: { provider: 'vapi', voiceId: '<name>' }` on the assistant
 * config. We hardcode the catalogue (it doesn't change often) so the
 * wizard's voice picker populates instantly without depending on a
 * Vapi-side endpoint that may or may not exist publicly.
 *
 * The voice ids are the canonical lowercase names Vapi accepts. The
 * preview URLs point at Vapi's public CDN samples each voice ships
 * with — operators can click a card and hear the voice without a
 * round trip through our preview synth endpoint.
 *
 * Default voice for new agents: 'elliot' (warm, conversational male).
 * Same default the Vapi demo "Riley" agent uses.
 */

import type { VoiceOption } from './types'

export const VAPI_NATIVE_DEFAULT_VOICE_ID = 'elliot'

export const VAPI_NATIVE_VOICES: VoiceOption[] = [
  {
    id: 'elliot',
    name: 'Elliot',
    language: 'en',
    labels: {
      gender: 'male',
      accent: 'american',
      age: 'middle_aged',
      description: 'Warm, conversational. The Vapi-demo default.',
    },
    previewUrl: 'https://storage.vapi.ai/elliot.wav',
  },
  {
    id: 'cole',
    name: 'Cole',
    language: 'en',
    labels: {
      gender: 'male',
      accent: 'american',
      age: 'young',
      description: 'Friendly and engaging.',
    },
    previewUrl: 'https://storage.vapi.ai/cole.wav',
  },
  {
    id: 'harry',
    name: 'Harry',
    language: 'en',
    labels: {
      gender: 'male',
      accent: 'american',
      age: 'middle_aged',
      description: 'Confident and direct.',
    },
    previewUrl: 'https://storage.vapi.ai/harry.wav',
  },
  {
    id: 'spencer',
    name: 'Spencer',
    language: 'en',
    labels: {
      gender: 'male',
      accent: 'american',
      age: 'middle_aged',
      description: 'Professional, polished.',
    },
    previewUrl: 'https://storage.vapi.ai/spencer.wav',
  },
  {
    id: 'rohan',
    name: 'Rohan',
    language: 'en',
    labels: {
      gender: 'male',
      accent: 'indian',
      age: 'middle_aged',
      description: 'Indian English, articulate.',
    },
    previewUrl: 'https://storage.vapi.ai/rohan.wav',
  },
  {
    id: 'hana',
    name: 'Hana',
    language: 'en',
    labels: {
      gender: 'female',
      accent: 'american',
      age: 'young',
      description: 'Bright, energetic.',
    },
    previewUrl: 'https://storage.vapi.ai/hana.wav',
  },
  {
    id: 'paige',
    name: 'Paige',
    language: 'en',
    labels: {
      gender: 'female',
      accent: 'american',
      age: 'middle_aged',
      description: 'Reassuring, professional.',
    },
    previewUrl: 'https://storage.vapi.ai/paige.wav',
  },
  {
    id: 'neha',
    name: 'Neha',
    language: 'en',
    labels: {
      gender: 'female',
      accent: 'indian',
      age: 'middle_aged',
      description: 'Indian English, warm.',
    },
    previewUrl: 'https://storage.vapi.ai/neha.wav',
  },
]

/** Get a Vapi-native voice by id, with case-insensitive matching. */
export function getVapiNativeVoice(voiceId: string): VoiceOption | null {
  const lower = voiceId.toLowerCase()
  return VAPI_NATIVE_VOICES.find(v => v.id === lower) ?? null
}
