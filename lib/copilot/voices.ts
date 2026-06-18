/**
 * Co-Pilot voice + intro-name selection.
 *
 * Why this exists: with no voice pinned, Gemini's native-audio output
 * drifts in accent within and across calls ("the voice changes accents
 * for some reason"). A named agent can now PIN one voice and keep it, or
 * choose 'rotate' to behave like a real team of humans — a different
 * voice AND a different human intro name each session.
 *
 * Safety: we only ever send Gemini a voiceName the operator explicitly
 * chose (or one drawn from the validated pool below). An unset voice
 * stays null → Gemini's built-in default, which is always valid for the
 * model. We never invent a default voiceName that might be rejected and
 * break the session.
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

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export interface ResolvedCopilotVoice {
  /** Gemini prebuiltVoiceConfig voiceName, or null = Gemini's default. */
  voiceName: string | null
  /** Name the agent introduces itself with this session. */
  displayName: string
}

/**
 * Resolve the voice + intro name for ONE session.
 *  - 'rotate'         → random pool voice + random human name
 *  - a valid voice id → that voice pinned, the agent keeps its own name
 *  - null / unknown   → COPILOT_VOICE env if set, else null (Gemini default)
 */
export function resolveCopilotVoice(
  voice: string | null | undefined,
  agentName: string,
): ResolvedCopilotVoice {
  if (voice === ROTATE_VOICE) {
    return { voiceName: pick(COPILOT_VOICES).id, displayName: pick(COPILOT_INTRO_NAMES) }
  }
  const valid = COPILOT_VOICES.some(v => v.id === voice)
  return {
    voiceName: valid ? (voice as string) : (process.env.COPILOT_VOICE || null),
    displayName: agentName,
  }
}
