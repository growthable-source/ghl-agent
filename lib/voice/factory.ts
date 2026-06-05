import type { VoiceAdapter, VoiceProviderId } from './types'
import { VapiVoiceAdapter } from './vapi-adapter'

/**
 * Voice provider factory.
 *
 * The platform has ONE runtime voice provider: Vapi. It owns the phone
 * bridge, owns the @vapi-ai/web browser SDK, and accepts multiple TTS
 * engines (Vapi-native, ElevenLabs, …) on the assistant config's voice
 * block. The engine choice lives on VapiConfig.ttsProvider — see
 * lib/voice/vapi-adapter.ts (buildVapiVoiceBlock + resolveVoiceEngine)
 * for how it maps onto Vapi's voice.provider field.
 *
 * This function is kept (rather than inlining `new VapiVoiceAdapter()`)
 * so anyone reading old call sites still finds a familiar entry point.
 */
export function getVoiceAdapter(_provider?: VoiceProviderId | string | null): VoiceAdapter {
  return new VapiVoiceAdapter()
}

/**
 * Lightweight summary used by the legacy Voice page's "providers"
 * dropdown. Now reports a single entry — Vapi — so any UI still
 * reading from this can render a stable single-option picker without
 * crashing. Operator-facing engine choice (Vapi-native vs ElevenLabs)
 * lives inside the voice wizard / config tab, not here.
 */
export function listVoiceProviders(): Array<{
  id: VoiceProviderId
  name: string
  description: string
  envVar: string
}> {
  return [
    {
      id: 'vapi',
      name: 'Vapi',
      description: 'Phone + browser + widget. Choose a Vapi-native voice or any ElevenLabs voice as the TTS engine inside the agent config.',
      envVar: 'VAPI_API_KEY',
    },
  ]
}
