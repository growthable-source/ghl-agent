import { describe, it, expect } from 'vitest'
import {
  normalizeQuestion,
  questionHash,
  isHumanOutbound,
  buildTranscript,
} from './conversation-mining-utils'
import type { Message } from '@/types'

function msg(p: Partial<Message>): Message {
  return {
    id: p.id ?? 'm',
    conversationId: 'c',
    locationId: 'loc',
    body: p.body ?? '',
    direction: p.direction ?? 'inbound',
    ...p,
  } as Message
}

describe('normalizeQuestion / questionHash (dedup key)', () => {
  it('collapses case, whitespace, and trailing punctuation', () => {
    expect(normalizeQuestion('  What are your   HOURS?? ')).toBe('what are your hours')
  })

  it('treats trivially-different phrasings as the same hash', () => {
    expect(questionHash('What are your hours?')).toBe(questionHash('what are your hours'))
  })

  it('keeps genuinely different questions distinct', () => {
    expect(questionHash('What are your hours?')).not.toBe(questionHash('Where are you located?'))
  })
})

describe('isHumanOutbound', () => {
  it('is true only for outbound with a sending user and no automated source', () => {
    expect(isHumanOutbound(msg({ direction: 'outbound', sentByUserId: 'u1' }))).toBe(true)
  })
  it('is false for inbound', () => {
    expect(isHumanOutbound(msg({ direction: 'inbound', sentByUserId: 'u1' }))).toBe(false)
  })
  it('is false for outbound without a user id (bot/automated)', () => {
    expect(isHumanOutbound(msg({ direction: 'outbound' }))).toBe(false)
  })
  it('is false for workflow-sourced outbound even with a user id', () => {
    expect(isHumanOutbound(msg({ direction: 'outbound', sentByUserId: 'u1', messageSource: 'workflow' }))).toBe(false)
  })
})

describe('buildTranscript', () => {
  it('returns null when no human answered the thread', () => {
    const msgs = [
      msg({ id: '1', direction: 'inbound', body: 'Are you open today?', dateAdded: '2026-01-01T10:00:00Z' }),
      msg({ id: '2', direction: 'outbound', body: 'Auto-reply', dateAdded: '2026-01-01T10:01:00Z' }), // no userId → automated
    ]
    expect(buildTranscript(msgs)).toBeNull()
  })

  it('builds a chronological transcript and drops automated outbound', () => {
    const msgs = [
      msg({ id: '2', direction: 'outbound', body: 'We are open 9–5.', sentByUserId: 'u1', dateAdded: '2026-01-01T10:05:00Z' }),
      msg({ id: '1', direction: 'inbound', body: 'What are your hours?', dateAdded: '2026-01-01T10:00:00Z' }),
      msg({ id: '3', direction: 'outbound', body: 'Promo blast', messageSource: 'campaign', dateAdded: '2026-01-01T10:10:00Z' }),
    ]
    const t = buildTranscript(msgs)
    expect(t).toBe('[Customer]: What are your hours?\n[Agent]: We are open 9–5.')
  })

  it('skips non-text channels like calls', () => {
    const msgs = [
      msg({ id: '1', direction: 'inbound', body: 'hello', messageType: 'TYPE_CALL', dateAdded: '2026-01-01T10:00:00Z' }),
      msg({ id: '2', direction: 'inbound', body: 'What is the price?', messageType: 'TYPE_SMS', dateAdded: '2026-01-01T10:01:00Z' }),
      msg({ id: '3', direction: 'outbound', body: 'It is $50.', messageType: 'TYPE_SMS', sentByUserId: 'u1', dateAdded: '2026-01-01T10:02:00Z' }),
    ]
    const t = buildTranscript(msgs)
    expect(t).toBe('[Customer]: What is the price?\n[Agent]: It is $50.')
  })
})
