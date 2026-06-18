import { describe, it, expect } from 'vitest'
import { filterGeminiVoices, toVoiceWire } from './voices-wire'

describe('voices-wire (gemini)', () => {
  it('returns the full catalogue when no search', () => {
    expect(filterGeminiVoices().length).toBe(8)
  })

  it('filters by name (case-insensitive)', () => {
    const r = filterGeminiVoices('kore')
    expect(r.map(v => v.id)).toEqual(['Kore'])
  })

  it('filters by description substring', () => {
    const r = filterGeminiVoices('authoritative')
    expect(r.map(v => v.id)).toContain('Charon')
  })

  it('maps to the shared wire shape', () => {
    const wire = toVoiceWire(filterGeminiVoices('puck')[0])
    expect(wire).toMatchObject({
      voice_id: 'Puck',
      name: 'Puck',
      preview_url: null,
      language: 'en',
      category: 'premade',
    })
    expect(wire.labels).toBeTypeOf('object')
  })
})
