/**
 * Co-Pilot spoken-language selection.
 *
 * The meeting runtime is Gemini Live native audio
 * (gemini-3.1-flash-live-preview). That model does not honor
 * speechConfig.languageCode — Google's Live API docs say native-audio
 * models pick the spoken language themselves, and the supported way to
 * steer it is the system instruction, which is locked into the
 * ephemeral token at connect. There is no mid-call message that
 * updates speech config; session resumption restores the same token.
 *
 * So language is a prompt contract, not a TTS locale lock:
 *   - understand English and Spanish on every call (bilingual input)
 *   - speak the language the operator selected
 *   - an explicit in-call request ("speak Spanish" / "habla en
 *     español") is allowed to switch, and then stick, because native
 *     audio can change language turn to turn. Unprompted switches
 *     (accent, noise, a name) are forbidden — that drift is a known
 *     failure mode when the instruction doesn't pin a language.
 *   - 'auto' ("Match the caller") is for public live-help where the
 *     operator can't know the visitor's language up front: start in
 *     English, follow the person into Spanish as soon as they SPEAK it
 *     (a greeting counts), then stick. Without it, a pinned English
 *     agent answered "Hola, ¿cómo estás?" in English — and an operator's
 *     persona instruction can't override, because this directive lands
 *     later in the prompt and forbids switching on "a few words".
 */

export interface CopilotLanguageOption {
  /** Stored on CopilotAgent.language. */
  code: 'en' | 'es' | 'auto'
  label: string
  /** BCP-47 tag stored on CopilotSession.locale for this choice. */
  locale: string
  /** Word the prompt uses ("Speak only in Spanish"). */
  speakName: string
}

export const COPILOT_LANGUAGES: CopilotLanguageOption[] = [
  { code: 'en', label: 'English', locale: 'en-US', speakName: 'English' },
  { code: 'es', label: 'Spanish', locale: 'es-US', speakName: 'Spanish' },
  // locale is only the session's BCP-47 tag; the spoken language follows the caller.
  { code: 'auto', label: 'Match the caller (English or Spanish)', locale: 'en-US', speakName: 'the caller\'s language' },
]

export const DEFAULT_COPILOT_LANGUAGE: CopilotLanguageOption = COPILOT_LANGUAGES[0]

export function resolveCopilotLanguage(language: string | null | undefined): CopilotLanguageOption {
  const raw = (language ?? '').trim().toLowerCase().replace(/_/g, '-')
  if (raw === 'es' || raw.startsWith('es-')) {
    return COPILOT_LANGUAGES[1]
  }
  if (raw === 'auto') return COPILOT_LANGUAGES[2]
  return DEFAULT_COPILOT_LANGUAGE
}

/** Value safe to persist on CopilotAgent.language. */
export function normalizeStoredCopilotLanguage(raw: unknown): CopilotLanguageOption['code'] {
  return resolveCopilotLanguage(typeof raw === 'string' ? raw : null).code
}

export function readPinnedCopilotLanguage(
  meta: Record<string, unknown> | null | undefined,
): CopilotLanguageOption['code'] | null {
  const raw = typeof meta?.pinnedLanguage === 'string' ? meta.pinnedLanguage : ''
  if (raw === 'en' || raw === 'es' || raw === 'auto') return raw
  return null
}

/**
 * System-instruction block. Native audio follows this; it is the
 * language control, including the live in-call switch.
 */
export function copilotLanguageDirective(language: string | null | undefined): string {
  const selected = resolveCopilotLanguage(language)
  if (selected.code === 'auto') {
    return [
      `## Language`,
      `- You understand spoken English and spoken Spanish equally well. Respond to either without asking the person to repeat themselves in the other language.`,
      `- Speak the language the person speaks to you. Open in English; as soon as the person speaks to you in Spanish — even a greeting such as "Hola" or "¿Cómo estás?" — reply in Spanish from that turn on, and keep speaking Spanish until they speak to you in English again.`,
      `- If someone explicitly asks you to switch — "speak Spanish", "habla en español", "switch to English", "en inglés" — switch on your next turn.`,
      `- Do not switch because of an accent, a proper name, or background noise. Keep the same voice whichever language you speak.`,
      `- Spoken conversation: natural, brief, no markdown, no lists read aloud.`,
    ].join('\n')
  }
  const other = selected.code === 'es' ? 'English' : 'Spanish'
  return [
    `## Language`,
    `- You understand spoken English and spoken Spanish equally well. Respond to either without asking the person to repeat themselves in the other language.`,
    `- Speak only in ${selected.speakName}. Keep this same voice and this spoken language for the whole call.`,
    `- If someone on the call explicitly asks you to switch the language you speak — for example "speak Spanish", "habla en español", "switch to English", or "en inglés" — switch on your next turn and stay in that language until they explicitly ask again.`,
    `- Do not switch languages because of an accent, a proper name, background noise, or a few words of ${other}.`,
    `- Spoken conversation: natural, brief, no markdown, no lists read aloud.`,
  ].join('\n')
}
