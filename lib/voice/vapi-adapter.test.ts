import { describe, it, expect, afterEach } from 'vitest'
import { buildElevenLabsVoiceBlock, elevenLabsModel, ELEVEN_DEFAULT_MODEL } from './vapi-adapter'

describe('elevenLabsModel', () => {
  const original = process.env.VAPI_ELEVENLABS_MODEL

  afterEach(() => {
    if (original === undefined) delete process.env.VAPI_ELEVENLABS_MODEL
    else process.env.VAPI_ELEVENLABS_MODEL = original
  })

  it('defaults to eleven_v3', () => {
    delete process.env.VAPI_ELEVENLABS_MODEL
    expect(elevenLabsModel()).toBe('eleven_v3')
    expect(ELEVEN_DEFAULT_MODEL).toBe('eleven_v3')
  })

  it('respects VAPI_ELEVENLABS_MODEL override', () => {
    process.env.VAPI_ELEVENLABS_MODEL = 'eleven_turbo_v2_5'
    expect(elevenLabsModel()).toBe('eleven_turbo_v2_5')
  })
})

describe('buildElevenLabsVoiceBlock', () => {
  it('emits provider 11labs and the default v3 model', () => {
    const block = buildElevenLabsVoiceBlock({ voiceId: 'abc123' })
    expect(block.provider).toBe('11labs')
    expect(block.voiceId).toBe('abc123')
    expect(block.model).toBe('eleven_v3')
  })

  it('drops nullable tuning params instead of writing nulls', () => {
    const block = buildElevenLabsVoiceBlock({
      voiceId: 'x',
      stability: null,
      similarityBoost: null,
      speed: null,
      style: null,
      language: null,
    })
    expect(block).not.toHaveProperty('stability')
    expect(block).not.toHaveProperty('similarityBoost')
    expect(block).not.toHaveProperty('speed')
    expect(block).not.toHaveProperty('style')
    expect(block).not.toHaveProperty('language')
  })

  it('passes through numeric tuning params', () => {
    const block = buildElevenLabsVoiceBlock({
      voiceId: 'x',
      stability: 0.5,
      similarityBoost: 0.75,
      speed: 1,
      style: 0,
      language: 'en',
    })
    expect(block.stability).toBe(0.5)
    expect(block.similarityBoost).toBe(0.75)
    expect(block.speed).toBe(1)
    expect(block.style).toBe(0)
    expect(block.language).toBe('en')
  })

  it('honours an explicit model param over the env default', () => {
    const block = buildElevenLabsVoiceBlock({ voiceId: 'x', model: 'eleven_multilingual_v2' })
    expect(block.model).toBe('eleven_multilingual_v2')
  })
})
