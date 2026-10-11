import { describe, expect, it } from 'vitest'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { config } from '@/middleware'

/**
 * Runs the REAL matcher through Next's own matcher implementation. A host
 * that does not match here SKIPS middleware entirely, i.e. gets no
 * custom-host allowlist — so look-alikes must match.
 */
const matches = (host: string, path = '/admin') =>
  unstable_doesMiddlewareMatch({ config, url: `https://${host}${path}`, headers: { host } })

describe('middleware matcher: broad entry', () => {
  it('skips our own hosts (their legacy paths are matched by the other entries)', () => {
    for (const h of ['app.xovera.io', 'xovera.io', 'www.xovera.io', 'widget.xovera.io', 'app.voxility.ai', 'voxility.ai', 'localhost', '127.0.0.1', 'abc.vercel.app']) {
      expect(matches(h, '/api/widget/w/config'), h).toBe(false)
    }
  })
  it('still matches the primary-host paths that always ran middleware', () => {
    for (const p of ['/', '/dashboard/x', '/embedded/widget-builder', '/api/workspaces/w/x', '/api/cron/follow-ups']) {
      expect(matches('app.xovera.io', p), p).toBe(true)
    }
  })
  it('matches customer hosts, including look-alikes that embed our domains or localhost', () => {
    for (const h of ['live.acme.com', 'live.xovera.io.acme.com', 'localhost.acme.com', 'x.localhost.acme.com',
      'xovera.io.evil.com', 'voxility.ai.evil.com', '127.0.0.1.acme.com', 'abc.vercel.app.acme.com', 'notxovera.io']) {
      expect(matches(h), h).toBe(true)
    }
  })
})
