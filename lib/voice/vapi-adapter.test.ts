import { describe, it, expect, afterEach } from 'vitest'
import {
  buildElevenLabsVoiceBlock,
  buildVapiVoiceBlock,
  elevenLabsModel,
  ELEVEN_DEFAULT_MODEL,
  resolveVoiceEngine,
  xaiProviderString,
} from './vapi-adapter'

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

describe('xaiProviderString', () => {
  const original = process.env.VAPI_XAI_PROVIDER

  afterEach(() => {
    if (original === undefined) delete process.env.VAPI_XAI_PROVIDER
    else process.env.VAPI_XAI_PROVIDER = original
  })

  it("defaults to 'xai'", () => {
    delete process.env.VAPI_XAI_PROVIDER
    expect(xaiProviderString()).toBe('xai')
  })

  it('respects VAPI_XAI_PROVIDER override', () => {
    process.env.VAPI_XAI_PROVIDER = 'x-ai'
    expect(xaiProviderString()).toBe('x-ai')
  })
})

describe('resolveVoiceEngine', () => {
  it('maps "xai" to xai', () => {
    expect(resolveVoiceEngine('xai')).toBe('xai')
  })

  it.each(['vapi', 'elevenlabs', '11labs', '', null, undefined])(
    'maps %p to elevenlabs (back-compat)',
    (input) => {
      expect(resolveVoiceEngine(input as any)).toBe('elevenlabs')
    },
  )
})

describe('buildVapiVoiceBlock — ElevenLabs engine', () => {
  it('emits provider "11labs" and the default v3 model', () => {
    const block = buildVapiVoiceBlock({ engine: 'elevenlabs', voiceId: 'abc123' })
    expect(block.provider).toBe('11labs')
    expect(block.voiceId).toBe('abc123')
    expect(block.model).toBe('eleven_v3')
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

  it('defaults engine to elevenlabs when omitted (back-compat)', () => {
    const block = buildVapiVoiceBlock({ voiceId: 'x' })
    expect(block.provider).toBe('11labs')
  })
})

describe('buildVapiVoiceBlock — xAI engine', () => {
  it('emits provider "xai" and the voiceId only', () => {
    const block = buildVapiVoiceBlock({ engine: 'xai', voiceId: 'eve' })
    expect(block.provider).toBe('xai')
    expect(block.voiceId).toBe('eve')
  })

  it('does NOT include the ElevenLabs model field', () => {
    const block = buildVapiVoiceBlock({ engine: 'xai', voiceId: 'eve' })
    expect(block).not.toHaveProperty('model')
  })

  it('strips ElevenLabs-specific tuning even when provided', () => {
    // Existing rows may carry leftover ElevenLabs tuning from a
    // previous config — Vapi rejects extra params on non-11labs
    // providers, so the builder must drop them.
    const block = buildVapiVoiceBlock({
      engine: 'xai',
      voiceId: 'eve',
      stability: 0.5,
      similarityBoost: 0.7,
      speed: 1.1,
      style: 0.3,
    })
    expect(block).not.toHaveProperty('stability')
    expect(block).not.toHaveProperty('similarityBoost')
    expect(block).not.toHaveProperty('speed')
    expect(block).not.toHaveProperty('style')
  })

  it('passes language through when set', () => {
    const block = buildVapiVoiceBlock({ engine: 'xai', voiceId: 'eve', language: 'en' })
    expect(block.language).toBe('en')
  })
})

describe('buildElevenLabsVoiceBlock — back-compat alias', () => {
  it('still produces an ElevenLabs block (engine is forced)', () => {
    const block = buildElevenLabsVoiceBlock({ voiceId: 'x' })
    expect(block.provider).toBe('11labs')
    expect(block.model).toBe('eleven_v3')
  })
})
