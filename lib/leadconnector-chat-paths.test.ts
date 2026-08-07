import { describe, it, expect } from 'vitest'
import { isPublicChatPath } from './leadconnector-chat-paths'

describe('isPublicChatPath', () => {
  it('allows the marketing site', () => {
    for (const path of [
      '/',
      '/compare',
      '/compare/intercom',
      '/alternatives',
      '/integrations',
      '/services',
      '/blog',
      '/blog/best-ai-agents-for-gohighlevel',
      '/docs',
      '/support',
      '/start',
      '/login',
      '/getting-started',
      '/help',
      '/ai-receptionist',
      '/ai-for-gyms',
      '/intercom-alternative',
    ]) {
      expect(isPublicChatPath(path), path).toBe(true)
    }
  })

  it('allows the generated prospect landing pages', () => {
    expect(isPublicChatPath('/try/acme-dental')).toBe(true)
    expect(isPublicChatPath('/redesign/acme-dental')).toBe(true)
  })

  it('blocks the app surfaces', () => {
    for (const path of [
      '/dashboard',
      '/dashboard/ws_123/agents',
      '/admin',
      '/admin/portals/1',
      '/portal/login',
      '/embedded/leadconnector',
      '/kiosk/front-desk',
      '/copilot/live',
      '/knowledge-share/abc123',
    ]) {
      expect(isPublicChatPath(path), path).toBe(false)
    }
  })

  it('blocks customer widget pages, where our bubble would sit on theirs', () => {
    expect(isPublicChatPath('/widget/wgt_123/embed')).toBe(false)
    expect(isPublicChatPath('/c/acme-support')).toBe(false)
  })

  it('matches prefixes on a segment boundary, not a substring', () => {
    // '/c' must not swallow '/compare', '/copilot' must not swallow a
    // future '/copilot-pricing' marketing page.
    expect(isPublicChatPath('/compare')).toBe(true)
    expect(isPublicChatPath('/contact')).toBe(true)
    expect(isPublicChatPath('/copilot-pricing')).toBe(true)
    expect(isPublicChatPath('/widgets-guide')).toBe(true)
    expect(isPublicChatPath('/administration')).toBe(true)
  })

  it('tolerates trailing slashes', () => {
    expect(isPublicChatPath('/dashboard/')).toBe(false)
    expect(isPublicChatPath('/blog/')).toBe(true)
    expect(isPublicChatPath('/')).toBe(true)
  })
})
