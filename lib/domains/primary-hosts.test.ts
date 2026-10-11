import { describe, expect, it } from 'vitest'
import { isPrimaryHost } from './primary-hosts'

describe('isPrimaryHost', () => {
  it('treats every host the app answers on as primary', () => {
    for (const h of ['xovera.io', 'app.xovera.io', 'www.xovera.io', 'widget.xovera.io', 'staging.xovera.io',
      'voxility.ai', 'app.voxility.ai', 'localhost', 'my-preview-abc.vercel.app']) {
      expect(isPrimaryHost(h), h).toBe(true)
    }
  })
  it('treats customer hosts as non-primary, including look-alikes', () => {
    for (const h of ['live.acme.com', 'notxovera.io', 'xovera.io.evil.com', 'evilvoxility.ai']) {
      expect(isPrimaryHost(h), h).toBe(false)
    }
  })
})
