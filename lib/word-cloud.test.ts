import { describe, it, expect } from 'vitest'
import { topTerms } from './word-cloud'

describe('topTerms', () => {
  it('returns empty for empty input', () => {
    expect(topTerms([])).toEqual([])
    expect(topTerms(['', '   '])).toEqual([])
  })

  it('counts repeated words above the min threshold', () => {
    const out = topTerms(['refund refund refund', 'where is my refund'], { minCount: 2 })
    const refund = out.find(t => t.term === 'refund')
    expect(refund?.count).toBe(4)
  })

  it('drops stopwords and short/numeric tokens', () => {
    const out = topTerms(['I want to know about it 42 99', 'the and or but'], { minCount: 1 })
    const terms = out.map(t => t.term)
    expect(terms).not.toContain('the')
    expect(terms).not.toContain('and')
    expect(terms).not.toContain('it')
    expect(terms).not.toContain('42')
  })

  it('surfaces bigrams as phrases', () => {
    const texts = Array(3).fill('how do I reset my password please')
    const out = topTerms(texts, { minCount: 2 })
    const phrase = out.find(t => t.term === 'reset password')
    expect(phrase).toBeTruthy()
  })

  it('respects the limit and sorts by count desc', () => {
    const out = topTerms(
      ['cancel cancel cancel', 'billing billing', 'shipping shipping shipping shipping'],
      { limit: 2, minCount: 2 },
    )
    expect(out).toHaveLength(2)
    expect(out[0].term).toBe('shipping')
    expect(out[0].count).toBeGreaterThanOrEqual(out[1].count)
  })

  it('drops common profanity so the cloud stays clean', () => {
    const out = topTerms(['ass ass ass delivery', 'shit shit happens here'], { minCount: 1 })
    const terms = out.map(t => t.term)
    expect(terms).not.toContain('ass')
    expect(terms).not.toContain('shit')
    // and the bigram built off them never appears either
    expect(terms).not.toContain('ass delivery')
    expect(terms).toContain('delivery')
  })

  it('is case-insensitive and strips punctuation', () => {
    const out = topTerms(['Refund!', 'REFUND?', 'refund.'], { minCount: 3 })
    expect(out.find(t => t.term === 'refund')?.count).toBe(3)
  })
})
