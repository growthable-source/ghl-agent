import { describe, it, expect } from 'vitest'
import {
  GEMINI_NATIVE_VOICES,
  GEMINI_NATIVE_VOICE_IDS,
  GEMINI_DEFAULT_VOICE_ID,
  getGeminiVoice,
} from './gemini-native-voices'

describe('gemini-native-voices', () => {
  it('exposes the real Gemini prebuilt voice ids', () => {
    expect(GEMINI_NATIVE_VOICE_IDS).toEqual([
      'Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr',
    ])
  })

  it('every voice is a well-formed VoiceOption with a description + gender label', () => {
    expect(GEMINI_NATIVE_VOICES).toHaveLength(GEMINI_NATIVE_VOICE_IDS.length)
    for (const v of GEMINI_NATIVE_VOICES) {
      expect(v.id).toBe(v.name)
      expect(v.language).toBe('en')
      expect(v.previewUrl).toBeNull()
      expect(v.labels?.description?.length).toBeGreaterThan(0)
      expect(['male', 'female']).toContain(v.labels?.gender)
    }
  })

  it('default voice is in the catalogue', () => {
    expect(GEMINI_NATIVE_VOICE_IDS).toContain(GEMINI_DEFAULT_VOICE_ID)
  })

  it('getGeminiVoice is case-insensitive and returns null for unknowns', () => {
    expect(getGeminiVoice('puck')?.id).toBe('Puck')
    expect(getGeminiVoice('Kore')?.id).toBe('Kore')
    expect(getGeminiVoice('Nope')).toBeNull()
    expect(getGeminiVoice('')).toBeNull()
  })
})
