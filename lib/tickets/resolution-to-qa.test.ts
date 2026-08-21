import { describe, it, expect } from 'vitest'
import { buildResolutionQaPrompt, parseResolutionQa, formatChatTranscript, buildTranscriptQaPrompt } from './resolution-to-qa'

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

describe('formatChatTranscript', () => {
  it('labels visitor vs agent turns and drops empties', () => {
    const t = formatChatTranscript([
      { role: 'visitor', content: 'How do I export?' },
      { role: 'agent', content: '' },
      { role: 'agent', content: 'Settings → Export.' },
    ])
    expect(t).toBe('CUSTOMER: How do I export?\nAGENT: Settings → Export.')
  })

  it('treats user/contact roles as the customer', () => {
    expect(formatChatTranscript([{ role: 'user', content: 'hi' }])).toBe('CUSTOMER: hi')
    expect(formatChatTranscript([{ role: 'contact', content: 'hi' }])).toBe('CUSTOMER: hi')
  })

  it('keeps only the most recent messages', () => {
    const msgs = Array.from({ length: 50 }, (_, i) => ({ role: 'visitor', content: `m${i}` }))
    const t = formatChatTranscript(msgs, { maxMessages: 3 })
    expect(t).toBe('CUSTOMER: m47\nCUSTOMER: m48\nCUSTOMER: m49')
  })

  it('caps total length from the end', () => {
    const t = formatChatTranscript([{ role: 'visitor', content: 'x'.repeat(100) }], { maxChars: 20 })
    expect(t.length).toBe(20)
  })

  it('drops system notes and non-text card messages', () => {
    const t = formatChatTranscript([
      { role: 'visitor', content: 'Do you sell shoes?' },
      { role: 'system', content: 'calendar misconfiguration' },
      { role: 'agent', content: '{"gid":"1","title":"Shoe"}', kind: 'product' },
      { role: 'agent', content: 'Yes, here are our shoes.', kind: 'text' },
    ])
    expect(t).toBe('CUSTOMER: Do you sell shoes?\nAGENT: Yes, here are our shoes.')
  })
})

describe('buildTranscriptQaPrompt', () => {
  it('embeds the transcript + brand and asks for JSON', () => {
    const { system, user } = buildTranscriptQaPrompt({ transcript: 'CUSTOMER: hi\nAGENT: hello', brandName: 'Acme' })
    expect(system.toLowerCase()).toContain('json')
    expect(user).toContain('CUSTOMER: hi')
    expect(user).toContain('Acme')
  })
})
