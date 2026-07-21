import { describe, it, expect } from 'vitest'
import { voicePreviewUrl } from './preview-url'

describe('voicePreviewUrl', () => {
  it('prefers a pre-recorded catalogue sample when one exists', () => {
    expect(voicePreviewUrl('elevenlabs', 'abc', 'https://cdn/x.mp3')).toBe('https://cdn/x.mp3')
  })

  it('synthesizes on demand for Cartesia voices (previewUrl is always null)', () => {
    expect(voicePreviewUrl('cartesia', 'f786b574-daa5-4673-aa0c-cbe3e8534c02', null))
      .toBe('/api/voices/preview?provider=cartesia&voice=f786b574-daa5-4673-aa0c-cbe3e8534c02')
  })

  it('synthesizes on demand for Gemini voices', () => {
    expect(voicePreviewUrl('gemini', 'Kore', null))
      .toBe('/api/voices/preview?provider=gemini&voice=Kore')
  })

  it('url-encodes the voice id', () => {
    expect(voicePreviewUrl('gemini', 'a b/c', null))
      .toBe('/api/voices/preview?provider=gemini&voice=a%20b%2Fc')
  })

  it('returns null for engines with no sample and no synth route', () => {
    expect(voicePreviewUrl('vapi', 'elliot', null)).toBeNull()
    expect(voicePreviewUrl('elevenlabs', 'abc', null)).toBeNull()
  })

  it('returns null without a voice id', () => {
    expect(voicePreviewUrl('cartesia', '', null)).toBeNull()
  })
})
