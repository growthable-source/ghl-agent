import { describe, expect, it } from 'vitest'
import { isAllowedOnCustomHost, isBlockedOnCustomHost, validateWorkspaceDomain } from './hostname'

describe('validateWorkspaceDomain', () => {
  it('accepts a subdomain and normalizes it', () => {
    expect(validateWorkspaceDomain('https://Live.Acme.com/path')).toEqual({ ok: true, hostname: 'live.acme.com' })
  })
  it('rejects apex domains', () => {
    expect(validateWorkspaceDomain('acme.com').ok).toBe(false)
    expect(validateWorkspaceDomain('acme.co.uk').ok).toBe(false)
  })
  it('accepts a subdomain of a multi-part TLD', () => {
    expect(validateWorkspaceDomain('live.acme.co.uk').ok).toBe(true)
  })
  it('rejects junk', () => {
    expect(validateWorkspaceDomain('').ok).toBe(false)
    expect(validateWorkspaceDomain('localhost').ok).toBe(false)
    expect(validateWorkspaceDomain('not a host').ok).toBe(false)
  })
  it('rejects reserved and primary hosts', () => {
    expect(validateWorkspaceDomain('foo.xovera.io').ok).toBe(false)
    expect(validateWorkspaceDomain('live.voxility.ai').ok).toBe(false)
    expect(validateWorkspaceDomain('app.voxility.ai').ok).toBe(false)
    for (const h of ['live.xovera.io.acme.com', 'x.localhost.acme.com', 'a.voxility.ai.evil.com', 'x.vercel.app.acme.com']) {
      expect(validateWorkspaceDomain(h).ok, h).toBe(false)
    }
    expect(validateWorkspaceDomain('x.vercel.app').ok).toBe(false)
    expect(validateWorkspaceDomain('app.ours.example', ['ours.example']).ok).toBe(false)
  })
})

describe('isAllowedOnCustomHost', () => {
  it('allows copilot, widget and portal surfaces', () => {
    for (const p of ['/', '/copilot/live/cpa_x', '/api/copilot/public/k/session', '/copilot.js', '/widget.js',
      '/widget/w1/live', '/api/widget/w1/config', '/c/slug', '/api/voice/gemini/tool', '/logo-white.svg', '/portal/login', '/api/auth/leadconnector-agency/portal-install', '/icon.svg', '/manifest.webmanifest', '/robots.txt', '/brands/x.png', '/api/health', '/_next/static/a.js']) {
      expect(isAllowedOnCustomHost(p), p).toBe(true)
    }
  })
  it('blocks dashboard, auth, admin and workspace APIs', () => {
    for (const p of ['/dashboard/x', '/api/auth/session', '/admin', '/api/workspaces/w/domain', '/api/auth/callback/google', '/login',
      '/api/vapi/webhook', '/api/voice/gemini/token', '/copilot/bot/tok', '/api/copilot/meeting/tok', '/copilotevil']) {
      expect(isAllowedOnCustomHost(p), p).toBe(false)
    }
  })
})

describe('isBlockedOnCustomHost', () => {
  it('never blocks any of our own hosts, on any path', () => {
    for (const h of ['app.xovera.io', 'app.voxility.ai', 'widget.xovera.io', 'www.xovera.io', 'x.vercel.app', 'localhost']) {
      for (const p of ['/dashboard/w', '/login', '/api/auth/callback/google', '/api/webhooks/stripe', '/api/health']) {
        expect(isBlockedOnCustomHost(h, p), `${h}${p}`).toBe(false)
      }
    }
  })
  it('blocks private surfaces on a customer host but serves the public ones', () => {
    expect(isBlockedOnCustomHost('live.acme.com', '/dashboard/w')).toBe(true)
    expect(isBlockedOnCustomHost('live.acme.com', '/api/auth/session')).toBe(true)
    expect(isBlockedOnCustomHost('live.acme.com', '/copilot/live/cpa_x')).toBe(false)
    expect(isBlockedOnCustomHost('live.acme.com', '/widget.js')).toBe(false)
  })
})
