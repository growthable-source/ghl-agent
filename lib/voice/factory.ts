import type { VoiceAdapter, VoiceProviderId } from './types'
import { VapiVoiceAdapter } from './vapi-adapter'
import { XaiVoiceAdapter } from './xai-adapter'

/**
 * Resolve a VoiceAdapter for a given provider id. Unknown providers fall
 * back to Vapi (the original default) rather than throwing — that keeps
 * agents that predate the provider column working.
 *
 * The adapters themselves are stateless — no DB or network work happens
 * until a method is called — so constructing one per request is cheap.
 */
export function getVoiceAdapter(provider: VoiceProviderId | string | null | undefined): VoiceAdapter {
  switch (provider) {
    case 'xai':
      return new XaiVoiceAdapter()
    case 'vapi':
    default:
      return new VapiVoiceAdapter()
  }
}

/**
 * Lightweight summary of every provider we know about, used by the Voice
 * page to render the provider dropdown with capabilities up front.
 * Single source of truth — if you add a provider, add it here too.
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
      name: 'Vapi (ElevenLabs)',
      description: 'Phone + browser + widget. 5000+ ElevenLabs voices. Full platform.',
      envVar: 'VAPI_API_KEY',
    },
    {
      id: 'xai',
      name: 'Grok (xAI)',
      description: 'Browser + widget + TTS. Five expressive Grok voices. Phone support via Twilio bridge — coming in a later wave.',
      envVar: 'XAI_API_KEY',
    },
  ]
}
