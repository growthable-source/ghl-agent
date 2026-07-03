import { describe, it, expect } from 'vitest'
import {
  formatBrandHistoryBlock,
  formatRequesterHistoryBlock,
  formatConversationsBlock,
  formatSnippetsBlock,
  formatNegativeKeywordsBlock,
  findNegativeKeywordHits,
} from './reply-context'

const ticket = (over: Partial<{
  ticketNumber: number; subject: string; status: string; summary: string | null
  createdAt: Date; lastActivityAt: Date
}> = {}) => ({
  ticketNumber: 42,
  subject: 'Billing question',
  status: 'open',
  summary: null,
  createdAt: new Date(),
  lastActivityAt: new Date(),
  ...over,
})

describe('formatBrandHistoryBlock', () => {
  it('returns empty string for no tickets', () => {
    expect(formatBrandHistoryBlock([])).toBe('')
  })

  it('counts open/pending in the header and lists one line per ticket', () => {
    const block = formatBrandHistoryBlock([
      ticket({ status: 'open' }),
      ticket({ ticketNumber: 43, status: 'resolved' }),
      ticket({ ticketNumber: 44, status: 'pending' }),
    ])
    expect(block).toContain('(3 shown, 2 open/pending)')
    expect(block).toContain('#42')
    expect(block).toContain('#44 · pending')
  })
})

describe('formatRequesterHistoryBlock', () => {
  it('flags non-terminal tickets as STILL OPEN and includes summaries', () => {
    const block = formatRequesterHistoryBlock(
      [
        ticket({ status: 'on_hold', summary: 'Waiting on refund\nconfirmation' }),
        ticket({ ticketNumber: 43, status: 'closed', summary: null }),
      ],
      'jane@example.com',
    )
    expect(block).toContain('jane@example.com')
    expect(block).toContain('[STILL OPEN]')
    // newlines collapsed in summaries
    expect(block).toContain('Waiting on refund confirmation')
    expect(block).not.toContain('#43 · closed [STILL OPEN]')
  })
})

describe('formatConversationsBlock', () => {
  it('skips conversations without summaries and returns empty when none have one', () => {
    const none = formatConversationsBlock(
      [{ aiSummary: null, status: 'ended', lastMessageAt: new Date(), visitorEmail: null, visitorName: null }],
      'jane@example.com',
    )
    expect(none).toBe('')
  })

  it('marks the requester’s own conversations case-insensitively', () => {
    const block = formatConversationsBlock(
      [
        { aiSummary: 'Asked about pricing', status: 'ended', lastMessageAt: new Date(), visitorEmail: 'JANE@Example.com', visitorName: 'Jane' },
        { aiSummary: 'Bug report', status: 'active', lastMessageAt: new Date(), visitorEmail: 'other@x.com', visitorName: null },
      ],
      'jane@example.com',
    )
    expect(block).toContain('THIS CUSTOMER] Asked about pricing')
    expect(block).toContain('other@x.com] Bug report')
  })
})

describe('formatSnippetsBlock', () => {
  it('lists snippets with titles and preserves link content', () => {
    const block = formatSnippetsBlock([
      { title: 'Book a call', content: 'https://cal.com/acme/30min', kind: 'link' },
    ])
    expect(block).toContain('Book a call: https://cal.com/acme/30min')
    expect(block).toContain('VERBATIM')
  })

  it('is empty with no snippets', () => {
    expect(formatSnippetsBlock([])).toBe('')
  })
})

describe('formatNegativeKeywordsBlock', () => {
  it('quotes each keyword', () => {
    const block = formatNegativeKeywordsBlock(['cheap', 'guarantee'])
    expect(block).toContain('- "cheap"')
    expect(block).toContain('- "guarantee"')
  })
})

describe('findNegativeKeywordHits', () => {
  it('matches case-insensitively as substrings', () => {
    const hits = findNegativeKeywordHits(
      'We GUARANTEE the best value on the market.',
      ['guarantee', 'cheap', ' '],
    )
    expect(hits).toEqual(['guarantee'])
  })

  it('returns empty for a clean draft', () => {
    expect(findNegativeKeywordHits('All good here.', ['refund'])).toEqual([])
  })
})
