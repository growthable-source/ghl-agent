import { describe, expect, it } from 'vitest'
import { isAllowedOnCustomHost, validateWorkspaceDomain } from './hostname'

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
    expect(validateWorkspaceDomain('x.vercel.app').ok).toBe(false)
    expect(validateWorkspaceDomain('app.ours.example', ['ours.example']).ok).toBe(false)
  })
})

describe('isAllowedOnCustomHost', () => {
  it('allows copilot, widget and portal surfaces', () => {
    for (const p of ['/', '/copilot/live/cpa_x', '/api/copilot/public/k/session', '/copilot.js', '/widget.js',
      '/widget/w1/live', '/api/widget/w1/config', '/c/slug', '/api/voice/gemini/tool', '/logo-white.svg', '/portal/login', '/_next/static/a.js']) {
      expect(isAllowedOnCustomHost(p), p).toBe(true)
    }
  })
  it('blocks dashboard, auth, admin and workspace APIs', () => {
    for (const p of ['/dashboard/x', '/api/auth/session', '/admin', '/api/workspaces/w/domain', '/login',
      '/api/vapi/webhook', '/api/voice/gemini/token', '/copilot/bot/tok', '/api/copilot/meeting/tok', '/copilotevil']) {
      expect(isAllowedOnCustomHost(p), p).toBe(false)
    }
  })
})
