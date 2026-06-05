import type { VoiceAdapter, VoiceProviderId } from './types'
import { VapiVoiceAdapter } from './vapi-adapter'

/**
 * Voice provider factory.
 *
 * The platform has ONE runtime voice provider: Vapi. It owns the phone
 * bridge, owns the @vapi-ai/web browser SDK, and accepts multiple TTS
 * engines (ElevenLabs, xAI Grok, …) on the assistant config's voice
 * block. The previous xAI "adapter" lived alongside Vapi as a parallel
 * realtime path; that path is gone now (every voice surface routes
 * through Vapi). xAI's role narrows to "TTS engine selectable inside
 * a Vapi assistant config" — see lib/voice/vapi-adapter.ts
 * (buildVapiVoiceBlock) for how the engine choice maps onto Vapi's
 * voice.provider field.
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
 * crashing. Operator-facing engine choice (ElevenLabs vs Grok) lives
 * inside the Vapi card / wizard, not here.
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
      description: 'Phone + browser + widget. Choose ElevenLabs v3 or xAI Grok as the TTS engine inside the agent config.',
      envVar: 'VAPI_API_KEY',
    },
  ]
}
