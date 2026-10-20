import { describe, expect, it } from 'vitest'
import { buildMeetingPrompt } from './prompt'
import {
  copilotLanguageDirective,
  normalizeStoredCopilotLanguage,
  readPinnedCopilotLanguage,
  resolveCopilotLanguage,
} from './language'

describe('resolveCopilotLanguage', () => {
  it('defaults to English and accepts Spanish, including regional tags', () => {
    expect(resolveCopilotLanguage(null).code).toBe('en')
    expect(resolveCopilotLanguage('en-AU').speakName).toBe('English')
    expect(resolveCopilotLanguage('es')).toMatchObject({ code: 'es', locale: 'es-US', speakName: 'Spanish' })
    expect(resolveCopilotLanguage('es-MX').code).toBe('es')
    expect(resolveCopilotLanguage('ES_ES').code).toBe('es')
    expect(normalizeStoredCopilotLanguage('nope')).toBe('en')
    expect(normalizeStoredCopilotLanguage('es')).toBe('es')
    expect(normalizeStoredCopilotLanguage('auto')).toBe('auto')
    expect(resolveCopilotLanguage('AUTO').code).toBe('auto')
  })

  it('reads only an en/es session pin', () => {
    expect(readPinnedCopilotLanguage({ pinnedLanguage: 'es' })).toBe('es')
    expect(readPinnedCopilotLanguage({ pinnedLanguage: 'auto' })).toBe('auto')
    expect(readPinnedCopilotLanguage({ pinnedLanguage: 'es-MX' })).toBeNull()
    expect(readPinnedCopilotLanguage(undefined)).toBeNull()
  })
})

describe('copilotLanguageDirective', () => {
  it('speaks the selected language, understands both, and allows an explicit live switch', () => {
    const spanish = copilotLanguageDirective('es')
    expect(spanish).toContain('Speak only in Spanish')
    expect(spanish).toContain('understand spoken English and spoken Spanish')
    expect(spanish).toContain('habla en español')
    expect(spanish).toContain('switch to English')
    expect(spanish).not.toContain('Speak only in English')

    const english = copilotLanguageDirective('en')
    expect(english).toContain('Speak only in English')
    expect(english).toContain('speak Spanish')
    expect(english).toContain('Do not switch languages because of an accent')
  })

  it("'auto' follows the caller into Spanish on a greeting instead of pinning one language", () => {
    const auto = copilotLanguageDirective('auto')
    expect(auto).toContain('Speak the language the person speaks to you')
    expect(auto).toContain('Hola')
    expect(auto).not.toContain('Speak only in')
    expect(auto).not.toContain('a few words of')
  })
})

describe('buildMeetingPrompt language', () => {
  const agent = {
    name: 'Ada',
    persona: null,
    goal: null,
    steps: [] as string[],
    timeboxMinutes: 30,
    playbook: null,
  }

  it('uses the operator language rather than the session locale string', () => {
    const prompt = buildMeetingPrompt({
      agent,
      workspaceName: 'Acme',
      ragContext: '',
      locale: 'en-AU',
      language: 'es',
    })
    expect(prompt).toContain('Speak only in Spanish')
    expect(prompt).not.toContain('Spoken conversation in en-AU')
    expect(prompt).toContain('habla en español')
  })
})
