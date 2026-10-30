import { describe, expect, it } from 'vitest'
import { brandingIsWhitelabel, whitelabelManagerKind } from './manage-policy'

describe('whitelabelManagerKind', () => {
  it('lets the workspace owner manage white-label', () => {
    expect(whitelabelManagerKind('owner', false)).toBe('owner')
  })

  it('lets a platform admin manage white-label whatever their workspace role', () => {
    expect(whitelabelManagerKind(null, true)).toBe('platform')
    expect(whitelabelManagerKind('admin', true)).toBe('platform') // support session
    expect(whitelabelManagerKind('owner', true)).toBe('platform')
  })

  it('refuses admins (directors), members, viewers and agents', () => {
    for (const role of ['admin', 'member', 'viewer', 'agent']) {
      expect(whitelabelManagerKind(role, false)).toBeNull()
    }
  })

  it('refuses non-members and unknown roles', () => {
    expect(whitelabelManagerKind(null, false)).toBeNull()
    expect(whitelabelManagerKind(undefined, false)).toBeNull()
    expect(whitelabelManagerKind('Owner', false)).toBeNull()
  })
})

describe('brandingIsWhitelabel', () => {
  it('treats logo / Powered-by as white-label only once unlocked', () => {
    expect(brandingIsWhitelabel(true)).toBe(true)
    expect(brandingIsWhitelabel(false)).toBe(false)
  })
})
