import { describe, it, expect, afterEach } from 'vitest'
import {
  buildElevenLabsVoiceBlock,
  buildVapiVoiceBlock,
  elevenLabsModel,
  ELEVEN_DEFAULT_MODEL,
  resolveVoiceEngine,
} from './vapi-adapter'

describe('elevenLabsModel', () => {
  const original = process.env.VAPI_ELEVENLABS_MODEL

  afterEach(() => {
    if (original === undefined) delete process.env.VAPI_ELEVENLABS_MODEL
    else process.env.VAPI_ELEVENLABS_MODEL = original
  })

  it('defaults to eleven_turbo_v2_5 (Vapi-recommended for phone)', () => {
    delete process.env.VAPI_ELEVENLABS_MODEL
    expect(elevenLabsModel()).toBe('eleven_turbo_v2_5')
    expect(ELEVEN_DEFAULT_MODEL).toBe('eleven_turbo_v2_5')
  })

  it('respects VAPI_ELEVENLABS_MODEL override (e.g. opt into v3)', () => {
    process.env.VAPI_ELEVENLABS_MODEL = 'eleven_v3'
    expect(elevenLabsModel()).toBe('eleven_v3')
  })
})

describe('resolveVoiceEngine', () => {
  it('maps "elevenlabs" / "11labs" to elevenlabs', () => {
    expect(resolveVoiceEngine('elevenlabs')).toBe('elevenlabs')
    expect(resolveVoiceEngine('11labs')).toBe('elevenlabs')
  })

  it.each(['vapi', 'xai', '', null, undefined, 'unknown'])(
    'maps %p to vapi (the new default)',
    (input) => {
      expect(resolveVoiceEngine(input as any)).toBe('vapi')
    },
  )
})

describe('buildVapiVoiceBlock — Vapi-native engine (default)', () => {
  it('emits provider "vapi" + voiceId only', () => {
    const block = buildVapiVoiceBlock({ engine: 'vapi', voiceId: 'elliot' })
    expect(block.provider).toBe('vapi')
    expect(block.voiceId).toBe('elliot')
  })

  it('does NOT include the ElevenLabs model / tuning fields', () => {
    const block = buildVapiVoiceBlock({ engine: 'vapi', voiceId: 'elliot' })
    expect(block).not.toHaveProperty('model')
    expect(block).not.toHaveProperty('stability')
    expect(block).not.toHaveProperty('similarityBoost')
    expect(block).not.toHaveProperty('speed')
    expect(block).not.toHaveProperty('style')
  })

  it('strips ElevenLabs-specific tuning even when provided', () => {
    const block = buildVapiVoiceBlock({
      engine: 'vapi',
      voiceId: 'elliot',
      stability: 0.5,
      similarityBoost: 0.7,
      speed: 1.1,
      style: 0.3,
      model: 'should-be-ignored',
    })
    expect(block).not.toHaveProperty('model')
    expect(block).not.toHaveProperty('stability')
  })

  it('passes language through when set', () => {
    const block = buildVapiVoiceBlock({ engine: 'vapi', voiceId: 'elliot', language: 'en' })
    expect(block.language).toBe('en')
  })

  it('defaults engine to vapi when omitted', () => {
    const block = buildVapiVoiceBlock({ voiceId: 'elliot' })
    expect(block.provider).toBe('vapi')
  })
})

describe('buildVapiVoiceBlock — ElevenLabs engine', () => {
  it('emits provider "11labs" with the default turbo_v2_5 model', () => {
    const block = buildVapiVoiceBlock({ engine: 'elevenlabs', voiceId: 'abc123' })
    expect(block.provider).toBe('11labs')
    expect(block.voiceId).toBe('abc123')
    expect(block.model).toBe('eleven_turbo_v2_5')
  })

  it('drops nullable tuning params instead of writing nulls', () => {
    const block = buildVapiVoiceBlock({
      engine: 'elevenlabs',
      voiceId: 'x',
      stability: null, similarityBoost: null, speed: null, style: null, language: null,
    })
    expect(block).not.toHaveProperty('stability')
    expect(block).not.toHaveProperty('similarityBoost')
    expect(block).not.toHaveProperty('speed')
    expect(block).not.toHaveProperty('style')
    expect(block).not.toHaveProperty('language')
  })

  it('passes through numeric tuning + language', () => {
    const block = buildVapiVoiceBlock({
      engine: 'elevenlabs',
      voiceId: 'x',
      stability: 0.5, similarityBoost: 0.75, speed: 1, style: 0, language: 'en',
    })
    expect(block.stability).toBe(0.5)
    expect(block.similarityBoost).toBe(0.75)
    expect(block.speed).toBe(1)
    expect(block.style).toBe(0)
    expect(block.language).toBe('en')
  })

  it('honours an explicit model param over the env default', () => {
    const block = buildVapiVoiceBlock({ engine: 'elevenlabs', voiceId: 'x', model: 'eleven_multilingual_v2' })
    expect(block.model).toBe('eleven_multilingual_v2')
  })
})

describe('buildElevenLabsVoiceBlock — back-compat alias', () => {
  it('still produces an ElevenLabs block (engine is forced)', () => {
    const block = buildElevenLabsVoiceBlock({ voiceId: 'x' })
    expect(block.provider).toBe('11labs')
    expect(block.model).toBe('eleven_turbo_v2_5')
  })
})
