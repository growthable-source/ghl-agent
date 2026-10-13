import { describe, it, expect } from 'vitest'
import { NAV_ITEMS, activeNavItem, siblingsFor, settingsItemActive, workspaceRest } from './dashboard-nav'

const WS = 'ws1'

describe('dashboard-nav', () => {
  it('has unique item keys and every page path starts with / (or is root)', () => {
    expect(new Set(NAV_ITEMS.map(i => i.key)).size).toBe(NAV_ITEMS.length)
    for (const i of NAV_ITEMS) for (const p of i.pages) expect(p.path === '' || p.path.startsWith('/')).toBe(true)
  })

  it('maps legacy pages onto their consolidated nav item', () => {
    expect(activeNavItem(`/dashboard/${WS}/logs`, WS)?.key).toBe('live-ops')
    expect(activeNavItem(`/dashboard/${WS}/csat`, WS)?.key).toBe('performance')
    expect(activeNavItem(`/dashboard/${WS}/calls`, WS)?.key).toBe('conversations')
    expect(activeNavItem(`/dashboard/${WS}/agents/a1/identity`, WS)?.key).toBe('text-agents')
    expect(activeNavItem(`/dashboard/${WS}/tickets/reports`, WS)?.key).toBe('tickets')
  })

  it('does not treat the workspace root as a prefix of everything', () => {
    expect(activeNavItem(`/dashboard/${WS}`, WS)?.key).toBe('dashboard')
    expect(activeNavItem(`/dashboard/${WS}/contacts/c1`, WS)?.key).toBe('contacts')
    expect(activeNavItem(`/dashboard/${WS}/settings/members`, WS)).toBeNull()
  })

  it('does not match on a bare string prefix', () => {
    expect(activeNavItem(`/dashboard/${WS}/ticketsX`, WS)).toBeNull()
  })

  it('returns null outside the workspace', () => {
    expect(workspaceRest('/dashboard/other/inbox', WS)).toBeNull()
    expect(activeNavItem('/dashboard/other/inbox', WS)).toBeNull()
  })

  it('builds sibling tabs with exactly one active page', () => {
    const tabs = siblingsFor(`/dashboard/${WS}/activity`, WS)
    expect(tabs.map(t => t.label)).toContain('Logs')
    expect(tabs.filter(t => t.active)).toHaveLength(1)
    expect(tabs.find(t => t.active)?.path).toBe('/activity')
  })

  it('prefers the longest page match (tickets/reports over tickets)', () => {
    const tabs = siblingsFor(`/dashboard/${WS}/tickets/reports`, WS)
    expect(tabs.find(t => t.active)?.path).toBe('/tickets/reports')
  })

  it('returns no strip for single-page items', () => {
    expect(siblingsFor(`/dashboard/${WS}/inbox`, WS)).toEqual([])
  })

  it('settings General is exact-only', () => {
    expect(settingsItemActive('/settings', '/settings')).toBe(true)
    expect(settingsItemActive('/settings/members', '/settings')).toBe(false)
    expect(settingsItemActive('/settings/members', '/settings/members')).toBe(true)
  })
})
