import { describe, expect, it } from 'vitest'
import { partnerPortalSlug } from './portal-slug'

describe('partnerPortalSlug', () => {
  it('is deterministic — a provisioning retry must find the same portal', () => {
    expect(partnerPortalSlug('Acme Ltd', 'hc_123')).toBe(partnerPortalSlug('Acme Ltd', 'hc_123'))
  })

  it('differs for two businesses with the same name', () => {
    expect(partnerPortalSlug('Acme Ltd', 'hc_123')).not.toBe(partnerPortalSlug('Acme Ltd', 'hc_456'))
  })

  it('produces only the characters the portal slug rules allow', () => {
    const slug = partnerPortalSlug("Café & Sons' Agency!!", 'hc_abc')
    expect(slug).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
    expect(slug).toContain('cafe')
  })

  it('survives a name with no usable characters at all', () => {
    expect(partnerPortalSlug('***', 'hc_x')).toMatch(/^portal-[0-9a-f]{6}$/)
  })

  it('stays within the 60-char portal slug limit', () => {
    const slug = partnerPortalSlug('A'.repeat(200), 'hc_y')
    expect(slug.length).toBeLessThanOrEqual(60)
  })
})
