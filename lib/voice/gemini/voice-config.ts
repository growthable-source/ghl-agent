/**
 * The runtime-agnostic shape of a Gemini voice config (the `config` arg
 * buildGeminiVoiceSession takes) + its defaults. Kept separate from the
 * Prisma model so the pure session builder never imports prisma.
 */

export interface GeminiVoiceConfigShape {
  voiceName: string | null
  model: string
  firstMessage: string | null
  endCallMessage: string | null
  language: string | null
  maxDurationSecs: number
}

/** Env-overridable model; falls back to the consolidated audio-to-audio id. */
export function geminiVoiceModel(): string {
  return process.env.GEMINI_VOICE_MODEL || 'gemini-3.1-flash-live'
}

export function defaultGeminiVoiceConfig(): GeminiVoiceConfigShape {
  return {
    voiceName: null,
    model: geminiVoiceModel(),
    firstMessage: null,
    endCallMessage: null,
    language: null,
    maxDurationSecs: 600,
  }
}
