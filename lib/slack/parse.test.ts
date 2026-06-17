import { describe, it, expect } from 'vitest'
import { classifySlackReply } from './parse'

describe('classifySlackReply', () => {
  it('treats a plain reply as visitor-facing', () => {
    expect(classifySlackReply('Hi there, how can I help?')).toEqual({
      visibility: 'public',
      text: 'Hi there, how can I help?',
    })
  })

  it('routes a !-prefixed reply to an internal note and strips the marker', () => {
    expect(classifySlackReply('!who is taking this?')).toEqual({
      visibility: 'internal',
      text: 'who is taking this?',
    })
  })

  it('strips a single space after the marker', () => {
    expect(classifySlackReply('! grabbing it')).toEqual({
      visibility: 'internal',
      text: 'grabbing it',
    })
  })

  it('trims surrounding whitespace', () => {
    expect(classifySlackReply('   hello  ')).toEqual({ visibility: 'public', text: 'hello' })
  })

  it('returns empty text for marker-only messages', () => {
    expect(classifySlackReply('!')).toEqual({ visibility: 'internal', text: '' })
  })
})
