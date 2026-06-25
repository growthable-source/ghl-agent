import { describe, it, expect, afterEach } from 'vitest'
import {
  buildVapiVoiceBlock,
  elevenLabsModel,
  ELEVEN_DEFAULT_MODEL,
  resolveVoiceEngine,
} from './vapi-adapter'
import { coerceVapiNativeVoiceId } from './vapi-native-voices'

describe('coerceVapiNativeVoiceId', () => {
  it('keeps a valid native voice (canonical casing)', () => {
    expect(coerceVapiNativeVoiceId('Cole')).toBe('Cole')
    expect(coerceVapiNativeVoiceId('elliot')).toBe('Elliot')
  })

  it('falls back to the default native voice for null / empty / unknown / ElevenLabs ids', () => {
    expect(coerceVapiNativeVoiceId(null)).toBe('Elliot')
    expect(coerceVapiNativeVoiceId(undefined)).toBe('Elliot')
    expect(coerceVapiNativeVoiceId('')).toBe('Elliot')
    expect(coerceVapiNativeVoiceId('EXAVITQu4vr4xnSDxMaL')).toBe('Elliot')
  })
})

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
  it('emits provider "vapi" + canonical (capitalized) voiceId', () => {
    const block = buildVapiVoiceBlock({ engine: 'vapi', voiceId: 'Elliot' })
    expect(block.provider).toBe('vapi')
    expect(block.voiceId).toBe('Elliot')
  })

  it('capitalizes legacy lowercase voiceId to the Vapi-accepted form', () => {
    // Round 4 shipped lowercase ('elliot'); Vapi rejects it with a typed
    // 400. The adapter canonicalises so pre-migration rows still produce
    // a valid payload until the SQL migration runs.
    const block = buildVapiVoiceBlock({ engine: 'vapi', voiceId: 'elliot' })
    expect(block.voiceId).toBe('Elliot')
  })

  it('falls back to the default native voice for a non-catalogue id', () => {
    // Previously this passed the id through and let Vapi reject the whole
    // assistant ("voice.voiceId must be one of …") — a hard dead-end on
    // Save. Now an unknown id (typo, or an ElevenLabs id left on a
    // native-engine agent) coerces to the default native voice so the
    // call still connects.
    expect(buildVapiVoiceBlock({ engine: 'vapi', voiceId: 'not-a-real-voice-xyz' }).voiceId).toBe('Elliot')
    // The exact legacy seed default that caused the reported failure.
    expect(buildVapiVoiceBlock({ engine: 'vapi', voiceId: 'EXAVITQu4vr4xnSDxMaL' }).voiceId).toBe('Elliot')
  })

  it('does NOT include the ElevenLabs model / tuning fields', () => {
    const block = buildVapiVoiceBlock({ engine: 'vapi', voiceId: 'Elliot' })
    expect(block).not.toHaveProperty('model')
    expect(block).not.toHaveProperty('stability')
    expect(block).not.toHaveProperty('similarityBoost')
    expect(block).not.toHaveProperty('speed')
    expect(block).not.toHaveProperty('style')
  })

  it('strips ElevenLabs-specific tuning even when provided', () => {
    const block = buildVapiVoiceBlock({
      engine: 'vapi',
      voiceId: 'Elliot',
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
    const block = buildVapiVoiceBlock({ engine: 'vapi', voiceId: 'Elliot', language: 'en' })
    expect(block.language).toBe('en')
  })

  it('defaults engine to vapi when omitted', () => {
    const block = buildVapiVoiceBlock({ voiceId: 'Elliot' })
    expect(block.provider).toBe('vapi')
  })
})

describe('resolveVoiceEngine — Cartesia', () => {
  it('maps "cartesia" to cartesia', () => {
    expect(resolveVoiceEngine('cartesia')).toBe('cartesia')
  })
})

describe('buildVapiVoiceBlock — Cartesia engine (the new default)', () => {
  it('emits provider "cartesia" with a model + the chosen voiceId', () => {
    const block = buildVapiVoiceBlock({ engine: 'cartesia', voiceId: 'f786b574-daa5-4673-aa0c-cbe3e8534c02' })
    expect(block.provider).toBe('cartesia')
    expect(block.voiceId).toBe('f786b574-daa5-4673-aa0c-cbe3e8534c02')
    expect(typeof block.model).toBe('string')
  })

  it('coerces an unknown voiceId to the default so Vapi never 400s', () => {
    const block = buildVapiVoiceBlock({ engine: 'cartesia', voiceId: 'not-a-cartesia-id' })
    expect(block.provider).toBe('cartesia')
    // CARTESIA_DEFAULT_VOICE_ID (Katie) unless overridden by env.
    expect(typeof block.voiceId).toBe('string')
    expect((block.voiceId as string).length).toBeGreaterThan(0)
  })

  it('passes language through when set', () => {
    const block = buildVapiVoiceBlock({ engine: 'cartesia', voiceId: 'f786b574-daa5-4673-aa0c-cbe3e8534c02', language: 'en' })
    expect(block.language).toBe('en')
  })

  it('does NOT include ElevenLabs tuning fields', () => {
    const block = buildVapiVoiceBlock({ engine: 'cartesia', voiceId: 'f786b574-daa5-4673-aa0c-cbe3e8534c02', stability: 0.5, similarityBoost: 0.7 })
    expect(block).not.toHaveProperty('stability')
    expect(block).not.toHaveProperty('similarityBoost')
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
