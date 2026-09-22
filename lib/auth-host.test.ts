import { describe, expect, it } from 'vitest'
import { authRequestHref, envPresence } from './auth-host'

describe('authRequestHref', () => {
  it('keeps the request host for each public origin', () => {
    expect(authRequestHref({
      requestHref: 'https://app.voxility.ai/api/auth/providers',
      authUrl: 'https://app.xovera.io',
      nextAuthUrl: 'https://app.xovera.io',
      appUrl: 'https://app.xovera.io',
    })).toBe('https://app.voxility.ai/api/auth/providers')

    expect(authRequestHref({
      requestHref: 'https://app.xovera.io/api/auth/callback/google?code=abc',
      authUrl: 'https://app.voxility.ai',
      appUrl: 'https://app.xovera.io',
    })).toBe('https://app.xovera.io/api/auth/callback/google?code=abc')
  })
})

describe('envPresence', () => {
  it('reports set only when the value is non-empty', () => {
    expect(envPresence(undefined)).toBe('MISSING')
    expect(envPresence('')).toBe('MISSING')
    expect(envPresence('   ')).toBe('MISSING')
    expect(envPresence('present')).toBe('set')
  })
})
