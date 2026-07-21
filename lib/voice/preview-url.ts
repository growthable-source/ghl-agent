/**
 * Single source of truth for "can this voice be previewed, and from where?".
 *
 * Two engines ship a pre-recorded sample in their catalogue (ElevenLabs, and
 * anything proxied through it); Cartesia and Gemini ship none, so the sample
 * is synthesized on demand by /api/voices/preview. Vapi-native voices have
 * neither — their ▶ is genuinely dead and should say so.
 *
 * Pickers MUST derive both the click handler and the disabled/tooltip state
 * from this one function. They drifted apart once already: the wizard grew
 * the on-demand fallback but kept `disabled={!previewUrl}`, which disabled
 * every Cartesia and Gemini voice — i.e. every voice on the default tab.
 */

/** Providers /api/voices/preview can synthesize a sample for. */
const SYNTHESIZABLE = new Set(['cartesia', 'gemini'])

export function voicePreviewUrl(
  provider: string,
  voiceId: string,
  catalogueUrl?: string | null,
): string | null {
  if (catalogueUrl) return catalogueUrl
  if (!voiceId) return null
  if (!SYNTHESIZABLE.has(provider)) return null
  return `/api/voices/preview?provider=${provider}&voice=${encodeURIComponent(voiceId)}`
}
