/**
 * Pure helpers behind GET /api/voices?provider=gemini. Kept out of the
 * route so the filter + wire mapping are unit-testable under lib/**.
 */

import { GEMINI_NATIVE_VOICES } from '@/lib/voice/gemini-native-voices'
import type { VoiceOption } from '@/lib/voice/types'

export function filterGeminiVoices(search?: string): VoiceOption[] {
  if (!search) return GEMINI_NATIVE_VOICES
  const q = search.toLowerCase()
  return GEMINI_NATIVE_VOICES.filter(
    v =>
      v.name.toLowerCase().includes(q) ||
      (v.labels?.description ?? '').toLowerCase().includes(q),
  )
}

export function toVoiceWire(v: VoiceOption) {
  return {
    voice_id: v.id,
    name: v.name,
    preview_url: v.previewUrl ?? null,
    labels: v.labels ?? {},
    language: v.language ?? null,
    category: 'premade' as const,
  }
}
