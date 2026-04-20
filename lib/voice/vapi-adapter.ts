import { searchElevenLabsVoices } from '../vapi-client'
import type { VoiceAdapter, VoiceOption, VoiceProviderCapabilities } from './types'

/**
 * Vapi adapter. Wraps the existing Vapi + ElevenLabs integration without
 * changing its runtime — `listVoices` just funnels through the existing
 * searchElevenLabsVoices helper. Phone calls stay Vapi-only.
 *
 * The realtime browser path is handled by Vapi's own @vapi-ai/web SDK,
 * so we don't mint tokens here — the browser loads the SDK directly and
 * passes the public key. getRealtimeToken is intentionally undefined;
 * the UI checks capabilities and branches.
 */
export class VapiVoiceAdapter implements VoiceAdapter {
  provider = 'vapi' as const
  capabilities: VoiceProviderCapabilities = {
    phoneCalls: true,
    realtimeBrowser: true,
    ttsBatch: true,         // indirect — via ElevenLabs passthrough in Vapi
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
