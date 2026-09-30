/**
 * Co-Pilot voice + intro-name selection.
 *
 * Why this exists: with no voice pinned, Gemini Live native-audio
 * (the meeting bot's model) drifts timbre and accent within a call
 * and picks a different one next time. CopilotAgent.voice used to
 * default to null, and null omitted speechConfig entirely — that
 * unpinned path was the random voice. 'rotate' compounded it on
 * Meet/Zoom: connectMeetingSession rolled again every time the bot
 * page loaded, so a reload mid-call changed who was speaking.
 *
 * Every session now sends a concrete prebuilt voiceName from the
 * catalog below. Unset or unknown → DEFAULT_COPILOT_VOICE_ID (or
 * COPILOT_VOICE when that env value is itself a catalog id).
 * 'rotate' still rolls a voice and a human intro name, but only
 * once per session; the caller persists pinnedVoice /
 * pinnedDisplayName and reuses them for reconnects. We never send
 * Gemini a name outside COPILOT_VOICES.
 */

export interface CopilotVoiceOption {
  id: string
  label: string
}

// Gemini Live native-audio prebuilt voices — a curated, distinct subset
// of the broadly-supported names. Used both as the pinnable options and
// as the rotation pool.
export const COPILOT_VOICES: CopilotVoiceOption[] = [
  { id: 'Kore', label: 'Kore — warm, neutral' },
  { id: 'Puck', label: 'Puck — upbeat' },
  { id: 'Charon', label: 'Charon — deep, measured' },
  { id: 'Fenrir', label: 'Fenrir — energetic' },
  { id: 'Aoede', label: 'Aoede — bright' },
  { id: 'Leda', label: 'Leda — youthful' },
  { id: 'Orus', label: 'Orus — steady' },
  { id: 'Zephyr', label: 'Zephyr — light, airy' },
]

/** Pinned when the operator has not chosen a voice. Always a catalog id. */
export const DEFAULT_COPILOT_VOICE_ID = COPILOT_VOICES[0].id

/** Sentinel stored in CopilotAgent.voice for team-of-humans rotation. */
export const ROTATE_VOICE = 'rotate'

// Eclectic, human-sounding names the agent introduces itself with when
// rotation is on. Deliberately varied across cultures so a "team" feels
// real rather than templated.
export const COPILOT_INTRO_NAMES = [
  'Harry', 'Mia', 'Theo', 'Priya', 'Sofia', 'Marcus', 'Nina', 'Oscar',
  'Leila', 'Kai', 'Ruby', 'Diego', 'Maya', 'Felix', 'Anya', 'Jonah',
  'Iris', 'Ravi', 'Nora', 'Elena', 'Omar', 'Cleo', 'Mateo', 'Yuki',
]

export function isCopilotVoiceId(voice: string | null | undefined): voice is string {
  return !!voice && COPILOT_VOICES.some(v => v.id === voice)
}

/**
 * A voiceName safe to put in speechConfig. Catalog id, else a valid
 * COPILOT_VOICE env, else the default. Never null, never 'rotate'.
 */
export function coerceCopilotVoiceName(voice: string | null | undefined): string {
  if (isCopilotVoiceId(voice)) return voice
  const env = process.env.COPILOT_VOICE
  if (isCopilotVoiceId(env)) return env
  return DEFAULT_COPILOT_VOICE_ID
}

/** Value safe to persist on CopilotAgent.voice. */
export function normalizeStoredCopilotVoice(raw: unknown): string {
  if (raw === ROTATE_VOICE) return ROTATE_VOICE
  if (typeof raw === 'string' && isCopilotVoiceId(raw)) return raw
  return DEFAULT_COPILOT_VOICE_ID
}

export interface ResolvedCopilotVoice {
  /** Gemini prebuiltVoiceConfig voiceName. Always a catalog id. */
  voiceName: string
  /** Name the agent introduces itself with this session. */
  displayName: string
  /** True when this call rolled the rotate pool — persist both fields. */
  rotated: boolean
}

/**
 * Resolve the voice + intro name for ONE session.
 *  - 'rotate'         → one pool voice + one human name (caller must persist)
 *  - a valid voice id → that voice, the agent keeps its own name
 *  - null / unknown   → coerced catalog voice (env, else Kore)
 */
export function resolveCopilotVoice(
  voice: string | null | undefined,
  agentName: string,
  rng: () => number = Math.random,
): ResolvedCopilotVoice {
  if (voice === ROTATE_VOICE) {
    const voiceName = COPILOT_VOICES[Math.min(COPILOT_VOICES.length - 1, Math.floor(rng() * COPILOT_VOICES.length))].id
    const displayName = COPILOT_INTRO_NAMES[Math.min(COPILOT_INTRO_NAMES.length - 1, Math.floor(rng() * COPILOT_INTRO_NAMES.length))]
    return { voiceName, displayName, rotated: true }
  }
  return {
    voiceName: coerceCopilotVoiceName(voice),
    displayName: agentName,
    rotated: false,
  }
}

/** Voice already chosen for this session, if the metadata pin is a catalog id. */
export function readPinnedCopilotVoice(
  meta: Record<string, unknown> | null | undefined,
): { voiceName: string; displayName: string | null } | null {
  const voiceName = typeof meta?.pinnedVoice === 'string' ? meta.pinnedVoice : ''
  if (!isCopilotVoiceId(voiceName)) return null
  const displayName = typeof meta?.pinnedDisplayName === 'string' && meta.pinnedDisplayName.trim()
    ? meta.pinnedDisplayName.trim()
    : null
  return { voiceName, displayName }
}
