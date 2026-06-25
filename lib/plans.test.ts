import { describe, it, expect } from 'vitest'
import { effectiveVoiceMinuteLimit } from './plans'

describe('effectiveVoiceMinuteLimit', () => {
  // The bug this guards against: a workspace on a voice-enabled plan whose
  // denormalized voiceMinuteLimit column was never backfilled (stays 0)
  // was being told "voice isn't on your plan". The plan must win.
  it('falls back to the plan minutes when the column is 0 (the bug)', () => {
    expect(effectiveVoiceMinuteLimit('scale', 0)).toBe(200)
    expect(effectiveVoiceMinuteLimit('growth', 0)).toBe(60)
  })

  it('falls back to plan minutes when the column is null/undefined', () => {
    expect(effectiveVoiceMinuteLimit('scale', null)).toBe(200)
    expect(effectiveVoiceMinuteLimit('scale', undefined)).toBe(200)
  })

  it('honors a positive column as a custom override', () => {
    expect(effectiveVoiceMinuteLimit('growth', 500)).toBe(500)
  })

  it('returns 0 for plans without voice regardless of the column', () => {
    // Starter has no voice — must stay blocked even if a stale column says otherwise.
    expect(effectiveVoiceMinuteLimit('starter', 0)).toBe(0)
    expect(effectiveVoiceMinuteLimit('starter', 999)).toBe(0)
  })

  it('treats trial/free (voice-enabled) as on-plan', () => {
    expect(effectiveVoiceMinuteLimit('trial', 0)).toBe(30)
    expect(effectiveVoiceMinuteLimit('free', 0)).toBe(30)
  })

  it('unknown plan defaults to trial features (voice on)', () => {
    expect(effectiveVoiceMinuteLimit('', 0)).toBe(30)
  })
})
