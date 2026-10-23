import { describe, expect, it } from 'vitest'
import { brandAssetRewrite, isAllowedOnCustomHost, isBlockedOnCustomHost, validateWorkspaceDomain } from './hostname'

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
  it('serves the team sign-in and dashboard (workspace binding is enforced server-side)', () => {
    for (const p of ['/sign-in', '/api/sign-in/request-code', '/dashboard/x/inbox', '/api/workspaces', '/api/workspaces/w/tickets',
      '/api/me/super', '/api/auth/session', '/api/auth/csrf', '/api/auth/signout']) {
      expect(isAllowedOnCustomHost(p), p).toBe(true)
    }
  })
  it('blocks OAuth sign-in, admin and staff-only surfaces', () => {
    for (const p of ['/admin', '/api/admin/workspaces', '/api/auth/callback/google', '/api/auth/signin/google', '/login',
      '/api/workspaces-api-temp/x', '/api/billing/checkout', '/api/meta/oauth/connect',
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
    expect(isBlockedOnCustomHost('live.acme.com', '/admin')).toBe(true)
    expect(isBlockedOnCustomHost('live.acme.com', '/api/auth/callback/google')).toBe(true)
    expect(isBlockedOnCustomHost('live.acme.com', '/copilot/live/cpa_x')).toBe(false)
    expect(isBlockedOnCustomHost('live.acme.com', '/widget.js')).toBe(false)
  })
})

describe('brandAssetRewrite', () => {
  it('routes our file-based brand assets to the brand routes', () => {
    for (const p of ['/favicon.ico', '/icon.svg', '/apple-icon.png', '/opengraph-image', '/opengraph-image-abc123', '/twitter-image.png']) {
      expect(brandAssetRewrite(p), p).toBe('/api/brand/icon')
    }
    expect(brandAssetRewrite('/manifest.webmanifest')).toBe('/api/brand/manifest')
  })
  it('leaves every other path alone', () => {
    for (const p of ['/', '/widget.js', '/icon.svg.map', '/favicon.ico/x', '/logo-color.svg', '/portal/login']) {
      expect(brandAssetRewrite(p), p).toBeNull()
    }
  })
  it('every rewritten asset is reachable on a custom host (the allowlist runs first)', () => {
    for (const p of ['/favicon.ico', '/icon.svg', '/apple-icon.png', '/opengraph-image', '/twitter-image.png', '/manifest.webmanifest']) {
      expect(isBlockedOnCustomHost('live.acme.com', p), p).toBe(false)
    }
  })
})
