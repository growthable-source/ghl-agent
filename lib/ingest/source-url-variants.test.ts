import { describe, expect, it } from 'vitest'
import { sourceUrlLookupVariants } from './source-url-variants'

describe('sourceUrlLookupVariants', () => {
  it('covers scheme and a single trailing slash, lowercased', () => {
    const keys = sourceUrlLookupVariants('https://Example.com/docs/a/')
    expect(keys).toContain('https://example.com/docs/a/')
    expect(keys).toContain('https://example.com/docs/a')
    expect(keys).toContain('http://example.com/docs/a')
    expect(keys).toContain('http://example.com/docs/a/')
  })

  it('keeps the query string and does not turn it into an ILIKE pattern', () => {
    const keys = sourceUrlLookupVariants('https://example.com/a?id=1&q=100%')
    expect(keys.every(k => k.includes('?id=1&q=100%'))).toBe(true)
    expect(keys.some(k => k.includes('%//'))).toBe(false)
  })

  it('drops the fragment but keeps the original string', () => {
    const keys = sourceUrlLookupVariants('https://example.com/a#section')
    expect(keys).toContain('https://example.com/a#section')
    expect(keys).toContain('https://example.com/a')
  })

  it('returns the raw value for non-URL identifiers', () => {
    expect(sourceUrlLookupVariants('dQw4w9WgXcQ')).toEqual(['dqw4w9wgxcq'])
  })

  it('returns nothing for an empty string', () => {
    expect(sourceUrlLookupVariants('')).toEqual([])
  })
})