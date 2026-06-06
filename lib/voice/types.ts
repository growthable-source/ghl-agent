/**
 * Shared voice types.
 *
 * `VoiceOption` is the wire shape every voice catalogue endpoint
 * returns and every UI consumes. Used by both the Vapi-native
 * hardcoded list and the ElevenLabs adapter listVoices() call.
 *
 * (We previously had a VoiceAdapter / VoiceProviderCapabilities
 * interface scaffolding here for "future providers" — deleted in the
 * deletionism pass since we have one concrete adapter and no second
 * provider on the horizon. If a second provider is ever real, the
 * interface can come back then with concrete requirements.)
 */

export interface VoiceOption {
  /** Engine-specific voice ID (e.g. ElevenLabs cuid, or Vapi-native id like 'Elliot'). */
  id: string
  /** Human-readable name. */
  name: string
  /** BCP-47 language code if reported. */
  language?: string
  /** Labels (gender, accent, age, etc.) when exposed. */
  labels?: Record<string, string>
  /** Direct audio URL for click-to-preview, when the source supplies one. */
  previewUrl?: string | null
}
