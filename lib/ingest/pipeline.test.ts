import { describe, it, expect } from 'vitest'
import { canonicalUrlKey } from './pipeline'

describe('canonicalUrlKey', () => {
  it('folds scheme so http and https match', () => {
    expect(canonicalUrlKey('http://example.com/docs/a')).toBe(
      canonicalUrlKey('https://example.com/docs/a'),
    )
  })

  it('folds a single trailing slash', () => {
    expect(canonicalUrlKey('https://example.com/docs/a/')).toBe(
      canonicalUrlKey('https://example.com/docs/a'),
    )
  })

  it('folds host case and default ports', () => {
    expect(canonicalUrlKey('https://Example.COM:443/a')).toBe(
      canonicalUrlKey('https://example.com/a'),
    )
  })

  it('ignores the fragment', () => {
    expect(canonicalUrlKey('https://example.com/a#section')).toBe(
      canonicalUrlKey('https://example.com/a'),
    )
  })

  it('keeps the query string — it can change the resource', () => {
    expect(canonicalUrlKey('https://example.com/a?id=1')).not.toBe(
      canonicalUrlKey('https://example.com/a?id=2'),
    )
  })

  it('treats distinct pages as distinct', () => {
    expect(canonicalUrlKey('https://example.com/a')).not.toBe(
      canonicalUrlKey('https://example.com/b'),
    )
  })

  it('keeps the root path stable (does not strip the only slash)', () => {
    expect(canonicalUrlKey('https://example.com/')).toBe(
      canonicalUrlKey('https://example.com'),
    )
  })

  it('returns empty string for non-URL identifiers (bare YouTube id)', () => {
    expect(canonicalUrlKey('dQw4w9WgXcQ')).toBe('')
  })
})
