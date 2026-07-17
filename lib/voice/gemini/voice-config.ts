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

/** Env-overridable model; falls back to the consolidated audio-to-audio id.
 *  The id must support bidiGenerateContent — verified 2026-07-17: the Live
 *  API rejects `gemini-3.1-flash-live` (WS close 1008 "not found ... or not
 *  supported for bidiGenerateContent"); the `-preview` id is what the
 *  copilot runtime (COPILOT_MODEL_PRIMARY default) runs in production. */
export function geminiVoiceModel(): string {
  return process.env.GEMINI_VOICE_MODEL || 'gemini-3.1-flash-live-preview'
}

/** Ids that shipped as voice defaults but are rejected by the Live API.
 *  Stored GeminiVoiceConfig rows may still carry them — map to the current
 *  known-good id at session-build time so old rows self-heal. */
const RETIRED_LIVE_MODEL_IDS = new Set(['gemini-3.1-flash-live'])

export function normalizeGeminiVoiceModel(stored: string | null | undefined): string {
  if (!stored || RETIRED_LIVE_MODEL_IDS.has(stored)) return geminiVoiceModel()
  return stored
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
