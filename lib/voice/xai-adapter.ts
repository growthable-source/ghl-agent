import type {
  VoiceAdapter, VoiceOption, VoiceProviderCapabilities,
  SpeakOpts, RealtimeToken,
} from './types'

/**
 * XAI (Grok) voice adapter. Implements the VoiceAdapter surface over the
 * XAI Inference API — specifically:
 *
 *   GET  /v1/tts/voices                      — voice catalogue
 *   POST /v1/tts                             — batch text-to-speech
 *   POST /v1/realtime/client_secrets         — ephemeral tokens for browser
 *   wss://api.x.ai/v1/realtime               — realtime voice WebSocket
 *
 * Global API key lives in process.env.XAI_API_KEY. Getting that wrong is
 * the first thing that breaks so we surface the missing-key case loudly —
 * better to fail fast than silently fall back to an empty voice list.
 *
 * Phone calls are NOT supported natively by XAI — there's no PSTN, SIP,
 * or DID provisioning. capabilities.phoneCalls is false; when it becomes
 * true (Phase 2 Twilio bridge), the widget UI will unlock the phone tab
 * for XAI agents.
 */
export class XaiVoiceAdapter implements VoiceAdapter {
  provider = 'xai' as const
  capabilities: VoiceProviderCapabilities = {
    phoneCalls: false,        // ← becomes true when Twilio bridge ships
    realtimeBrowser: true,
    ttsBatch: true,
    voicePreview: true,       // we generate previews on-demand via /v1/tts
    widgetVoice: true,
  }

  private get apiKey(): string {
    const key = process.env.XAI_API_KEY
    if (!key) {
      throw new Error('XAI_API_KEY env var is not set. Configure it in Vercel to enable XAI voices.')
    }
    return key
  }

  async listVoices(_search?: string): Promise<VoiceOption[]> {
    const res = await fetch('https://api.x.ai/v1/tts/voices', {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`XAI listVoices failed (${res.status}): ${body.slice(0, 200)}`)
    }
    const data = await res.json() as { voices?: Array<{ voice_id: string; name: string; language?: string | null }> }
    const voices: VoiceOption[] = (data.voices ?? []).map(v => ({
      id: v.voice_id,
      name: v.name,
      language: v.language ?? undefined,
      // No preview URLs from XAI — the voice page builds them on-demand
      // through our /api/voice/xai/preview endpoint when the user clicks play.
      previewUrl: null,
    }))

    // Client-side search still works when the caller filters this list,
    // but XAI's catalogue is small enough (<10 voices) that we just
    // return everything and let the UI filter.
    return voices
  }

  async speak(text: string, voiceId: string, opts?: SpeakOpts): Promise<ArrayBuffer> {
    const res = await fetch('https://api.x.ai/v1/tts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        voice_id: voiceId,
        language: opts?.language ?? 'en',
        ...(opts?.codec || opts?.sampleRate || opts?.bitRate ? {
          output_format: {
            codec: opts?.codec ?? 'mp3',
            ...(opts?.sampleRate ? { sample_rate: opts.sampleRate } : {}),
            ...(opts?.bitRate ? { bit_rate: opts.bitRate } : {}),
          },
        } : {}),
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`XAI /v1/tts failed (${res.status}): ${body.slice(0, 200)}`)
    }
    return res.arrayBuffer()
  }

  async getRealtimeToken(opts?: { expiresInSeconds?: number }): Promise<RealtimeToken> {
    const seconds = Math.min(Math.max(opts?.expiresInSeconds ?? 300, 30), 3600)
    const res = await fetch('https://api.x.ai/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expires_after: { seconds } }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`XAI client_secrets failed (${res.status}): ${body.slice(0, 200)}`)
    }
    const data = await res.json() as { value: string; expires_at: number }
    return {
      value: data.value,
      expiresAt: data.expires_at,
      wsUrl: 'wss://api.x.ai/v1/realtime',
    }
  }
}
