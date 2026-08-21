import { describe, it, expect } from 'vitest'
import { buildResolutionQaPrompt, parseResolutionQa } from './resolution-to-qa'

describe('buildResolutionQaPrompt', () => {
  it('embeds the question, reply and brand, and asks for JSON + PII stripping', () => {
    const { system, user } = buildResolutionQaPrompt({
      question: 'How do I reset my password?',
      reply: 'Hi Jane, click Forgot Password on the login screen. — Support',
      brandName: 'Acme',
    })
    expect(system.toLowerCase()).toContain('json')
    expect(system.toLowerCase()).toMatch(/personal|pii|name|email/)
    expect(user).toContain('How do I reset my password?')
    expect(user).toContain('click Forgot Password')
    expect(user).toContain('Acme')
  })

  it('works without a brand name', () => {
    const { user } = buildResolutionQaPrompt({ question: 'q', reply: 'a' })
    expect(user).toContain('q')
    expect(user).toContain('a')
  })
})

describe('parseResolutionQa', () => {
  it('parses a clean JSON object', () => {
    const r = parseResolutionQa('{"question":"How do I reset my password?","answer":"Use Forgot Password."}')
    expect(r).toEqual({ question: 'How do I reset my password?', answer: 'Use Forgot Password.' })
  })

  it('parses JSON wrapped in a code fence + prose', () => {
    const raw = 'Here you go:\n```json\n{"question":"Q?","answer":"A."}\n```\nHope that helps'
    expect(parseResolutionQa(raw)).toEqual({ question: 'Q?', answer: 'A.' })
  })

  it('trims whitespace in fields', () => {
    expect(parseResolutionQa('{"question":"  Q?  ","answer":"\\nA.\\n"}'))
      .toEqual({ question: 'Q?', answer: 'A.' })
  })

  it('returns null when a field is missing or empty', () => {
    expect(parseResolutionQa('{"question":"Q?"}')).toBeNull()
    expect(parseResolutionQa('{"question":"","answer":"A."}')).toBeNull()
  })

  it('returns null on non-JSON garbage', () => {
    expect(parseResolutionQa('the model said no')).toBeNull()
    expect(parseResolutionQa('')).toBeNull()
  })
})
