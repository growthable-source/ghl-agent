import { describe, it, expect } from 'vitest'
import { generateProspectSlug, normalizeWebsiteDomain } from './slug'

describe('normalizeWebsiteDomain', () => {
  it('strips protocol, www, path, query, and lowercases', () => {
    expect(normalizeWebsiteDomain('https://www.AcmePlumbing.com/about?x=1')).toBe('acmeplumbing.com')
  })
  it('handles bare domains without protocol', () => {
    expect(normalizeWebsiteDomain('acmeplumbing.com')).toBe('acmeplumbing.com')
  })
  it('keeps non-www subdomains', () => {
    expect(normalizeWebsiteDomain('https://shop.acme.co.uk/x')).toBe('shop.acme.co.uk')
  })
  it('throws on garbage', () => {
    expect(() => normalizeWebsiteDomain('not a url at all !!')).toThrow()
  })
})

describe('generateProspectSlug', () => {
  it('slugifies the business name and appends a random suffix', () => {
    const slug = generateProspectSlug("Joe's Plumbing & Heating")
    expect(slug).toMatch(/^joe-s-plumbing-heating-[a-f0-9]{8}$/)
  })
  it('truncates very long names to keep slugs manageable', () => {
    const slug = generateProspectSlug('A'.repeat(200))
    // 40-char base + hyphen + 8-char suffix
    expect(slug.length).toBeLessThanOrEqual(49)
  })
  it('produces distinct slugs for the same name', () => {
    expect(generateProspectSlug('Acme')).not.toBe(generateProspectSlug('Acme'))
  })
  it('falls back to "demo" for names with no usable characters', () => {
    expect(generateProspectSlug('!!!')).toMatch(/^demo-[a-f0-9]{8}$/)
  })
})
