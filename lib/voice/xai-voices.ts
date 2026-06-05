/**
 * Slim helper that lists xAI Grok voices so the wizard's "Grok" tab
 * can populate.
 *
 * Replaces the old XaiVoiceAdapter (which also did realtime
 * WebSocket + batch TTS + ephemeral tokens — all dead code now that
 * every voice surface routes through Vapi). The voice ids returned
 * here are the ones Vapi accepts on the assistant config's
 * `voice.voiceId` field when `voice.provider: 'xai'`.
 *
 * Lives in its own file (not in vapi-adapter.ts) so vapi-adapter.ts
 * stays free of any direct xAI API call.
 */

import type { VoiceOption } from './types'

const XAI_VOICES_ENDPOINT = 'https://api.x.ai/v1/tts/voices'

/**
 * Hardcoded Grok voice catalogue used when:
 *   - XAI_API_KEY isn't set on the deployment
 *   - xAI's /v1/tts/voices endpoint returns 404 / empty (the path has
 *     shifted across xAI API revisions — sometimes /v1/tts/voices,
 *     sometimes /v1/audio/speech/voices)
 *   - the network call throws
 *
 * Without this fallback the wizard's Grok tab was rendering "No voices
 * match — try clearing the search" because the upstream lookup failed
 * silently. The voice ids are the canonical mnemonics Vapi accepts on
 * the assistant config's `voice.voiceId` field when
 * `voice.provider: 'xai'`.
 *
 * Refresh this list when xAI ships new Grok voices.
 */
const FALLBACK_GROK_VOICES: VoiceOption[] = [
  {
    id: 'eve',
    name: 'Eve',
    language: 'en',
    labels: { gender: 'female', accent: 'american', age: 'middle_aged', description: 'Warm, conversational; the most versatile default.' },
    previewUrl: null,
  },
  {
    id: 'aurora',
    name: 'Aurora',
    language: 'en',
    labels: { gender: 'female', accent: 'american', age: 'young', description: 'Bright, energetic — good for outbound sales.' },
    previewUrl: null,
  },
  {
    id: 'skylar',
    name: 'Skylar',
    language: 'en',
    labels: { gender: 'neutral', accent: 'american', age: 'young', description: 'Smooth, gender-neutral; modern and clear.' },
    previewUrl: null,
  },
  {
    id: 'jordan',
    name: 'Jordan',
    language: 'en',
    labels: { gender: 'male', accent: 'american', age: 'middle_aged', description: 'Confident, professional — good for receptionist roles.' },
    previewUrl: null,
  },
  {
    id: 'kai',
    name: 'Kai',
    language: 'en',
    labels: { gender: 'male', accent: 'american', age: 'young', description: 'Friendly, approachable — good for support.' },
    previewUrl: null,
  },
]

/**
 * Fetch the Grok voice catalogue. Tries xAI's live endpoint first;
 * falls back to the hardcoded list above on any failure (missing
 * key, network error, 404, empty response). Returns the same
 * VoiceOption shape the wizard consumes for ElevenLabs voices —
 * preview URLs are null on Grok voices (the wizard play button hits
 * /api/voice/preview which synthesises on demand).
 */
export async function listXaiVoices(): Promise<VoiceOption[]> {
  const apiKey = process.env.XAI_API_KEY
  if (!apiKey) {
    console.warn('[xai-voices] XAI_API_KEY not set — returning hardcoded Grok voice list.')
    return FALLBACK_GROK_VOICES
  }

  try {
    const res = await fetch(XAI_VOICES_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.warn(`[xai-voices] /v1/tts/voices failed (${res.status}): ${body.slice(0, 200)} — returning hardcoded list.`)
      return FALLBACK_GROK_VOICES
    }
    const data = (await res.json()) as {
      voices?: Array<{ voice_id: string; name: string; language?: string | null }>
    }
    const live = (data.voices ?? []).map(v => ({
      id: v.voice_id,
      name: v.name,
      language: v.language ?? undefined,
      previewUrl: null,
    }))
    // If xAI returned an empty list (which happens during their
    // catalogue migrations) prefer the hardcoded fallback over an
    // empty grid in the UI.
    if (live.length === 0) {
      console.warn('[xai-voices] /v1/tts/voices returned an empty list — returning hardcoded fallback.')
      return FALLBACK_GROK_VOICES
    }
    return live
  } catch (err: any) {
    console.warn(`[xai-voices] /v1/tts/voices threw: ${err?.message} — returning hardcoded list.`)
    return FALLBACK_GROK_VOICES
  }
}
