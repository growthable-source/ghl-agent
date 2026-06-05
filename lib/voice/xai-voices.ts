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
 * stays free of any direct xAI API call — it just constructs the
 * assistant-config voice block. The xAI inference API is only hit
 * here, only for the voice-catalogue list, and only when the user
 * actually opens the Grok tab in the wizard.
 */

import type { VoiceOption } from './types'

const XAI_VOICES_ENDPOINT = 'https://api.x.ai/v1/tts/voices'

function xaiApiKey(): string {
  const key = process.env.XAI_API_KEY
  if (!key) {
    throw new Error('XAI_API_KEY env var is not set. Set it on the deployment to enable Grok voices.')
  }
  return key
}

/**
 * Fetch the Grok voice catalogue. Returns the same VoiceOption shape
 * the wizard already consumes for ElevenLabs voices (no preview URL —
 * Grok previews are generated on-demand via /api/voice/preview).
 */
export async function listXaiVoices(): Promise<VoiceOption[]> {
  const res = await fetch(XAI_VOICES_ENDPOINT, {
    headers: { Authorization: `Bearer ${xaiApiKey()}` },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`xAI voices fetch failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const data = (await res.json()) as {
    voices?: Array<{ voice_id: string; name: string; language?: string | null }>
  }
  return (data.voices ?? []).map(v => ({
    id: v.voice_id,
    name: v.name,
    language: v.language ?? undefined,
    // No preview URLs from xAI's catalogue — the wizard's play button
    // hits /api/voice/preview which generates a fresh sample.
    previewUrl: null,
  }))
}
