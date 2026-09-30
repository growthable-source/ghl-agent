import { afterEach, describe, expect, it } from 'vitest'
import {
  COPILOT_INTRO_NAMES,
  COPILOT_VOICES,
  DEFAULT_COPILOT_VOICE_ID,
  coerceCopilotVoiceName,
  normalizeStoredCopilotVoice,
  readPinnedCopilotVoice,
  resolveCopilotVoice,
} from './voices'

const ORIGINAL_ENV = process.env.COPILOT_VOICE

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.COPILOT_VOICE
  else process.env.COPILOT_VOICE = ORIGINAL_ENV
})

describe('resolveCopilotVoice', () => {
  it('pins an unset voice to the catalog default instead of leaving it unset', () => {
    delete process.env.COPILOT_VOICE
    const resolved = resolveCopilotVoice(null, 'Ada')
    expect(resolved).toEqual({ voiceName: DEFAULT_COPILOT_VOICE_ID, displayName: 'Ada', rotated: false })
    expect(COPILOT_VOICES.some(v => v.id === resolved.voiceName)).toBe(true)
  })

  it('pins an unknown voice to the default', () => {
    delete process.env.COPILOT_VOICE
    expect(resolveCopilotVoice('not-a-voice', 'Ada').voiceName).toBe(DEFAULT_COPILOT_VOICE_ID)
    expect(coerceCopilotVoiceName('rotate')).toBe(DEFAULT_COPILOT_VOICE_ID)
  })

  it('keeps an explicit catalog voice and the agent name', () => {
    expect(resolveCopilotVoice('Puck', 'Ada')).toEqual({
      voiceName: 'Puck',
      displayName: 'Ada',
      rotated: false,
    })
  })

  it('uses a catalog COPILOT_VOICE env only when the agent has not chosen one', () => {
    process.env.COPILOT_VOICE = 'Orus'
    expect(coerceCopilotVoiceName(null)).toBe('Orus')
    expect(coerceCopilotVoiceName('Puck')).toBe('Puck')
    process.env.COPILOT_VOICE = 'not-a-catalog-voice'
    expect(coerceCopilotVoiceName(null)).toBe(DEFAULT_COPILOT_VOICE_ID)
  })

  it('rolls rotate once per call and stays inside the catalog', () => {
    const first = resolveCopilotVoice('rotate', 'Ada', () => 0)
    expect(first).toEqual({ voiceName: 'Kore', displayName: COPILOT_INTRO_NAMES[0], rotated: true })
    const last = resolveCopilotVoice('rotate', 'Ada', () => 0.999)
    expect(last.voiceName).toBe(COPILOT_VOICES[COPILOT_VOICES.length - 1].id)
    expect(last.displayName).toBe(COPILOT_INTRO_NAMES[COPILOT_INTRO_NAMES.length - 1])
    expect(last.rotated).toBe(true)
  })
})

describe('session voice pin', () => {
  it('reads a persisted catalog voice and ignores a bad pin', () => {
    expect(readPinnedCopilotVoice({ pinnedVoice: 'Leda', pinnedDisplayName: ' Mia ' })).toEqual({
      voiceName: 'Leda',
      displayName: 'Mia',
    })
    expect(readPinnedCopilotVoice({ pinnedVoice: 'rotate' })).toBeNull()
    expect(readPinnedCopilotVoice(undefined)).toBeNull()
  })

  it('stores a concrete voice, never an empty default', () => {
    expect(normalizeStoredCopilotVoice('')).toBe(DEFAULT_COPILOT_VOICE_ID)
    expect(normalizeStoredCopilotVoice(null)).toBe(DEFAULT_COPILOT_VOICE_ID)
    expect(normalizeStoredCopilotVoice('rotate')).toBe('rotate')
    expect(normalizeStoredCopilotVoice('Fenrir')).toBe('Fenrir')
  })
})
