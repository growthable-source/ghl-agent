import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SignJWT } from 'jose'

// Cookie jar stand-in for next/headers.
const jar = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => { jar.set(name, value) },
    delete: (name: string) => { jar.delete(name) },
  }),
  headers: async () => new Headers(),
}))
vi.mock('./db', () => ({
  db: { user: { findUnique: vi.fn(async () => ({ id: 'user_1' })), create: vi.fn() } },
}))

process.env.ADMIN_SESSION_SECRET = 'test-secret-for-support-session'

const { supportRoleFor, readSupportCookie, startSupportSession, SUPPORT_COOKIE } = await import('./support-session')
const { signAdminToken } = await import('./admin-auth')

const admin = { adminId: 'adm_1', email: 'staff@example.com', name: 'Staff', role: 'admin' as const, twoFactorVerified: true }

beforeEach(() => jar.clear())

describe('supportRoleFor', () => {
  const session = { user: { id: 'u' }, support: { adminId: 'adm_1', adminEmail: 'x', workspaceId: 'ws_a' } }

  it('grants the support role only for the scoped workspace', () => {
    expect(supportRoleFor(session, 'ws_a')).toBe('admin')
    expect(supportRoleFor(session, 'ws_b')).toBeNull()
  })

  it('grants nothing to a regular session', () => {
    expect(supportRoleFor({ user: { id: 'u' } }, 'ws_a')).toBeNull()
    expect(supportRoleFor(null, 'ws_a')).toBeNull()
  })
})

describe('support cookie', () => {
  it('round-trips the workspace, admin and user', async () => {
    await startSupportSession(admin, 'ws_a')
    expect(await readSupportCookie()).toEqual({ adminId: 'adm_1', workspaceId: 'ws_a', userId: 'user_1' })
  })

  it('rejects an admin login token presented as a support cookie', async () => {
    jar.set(SUPPORT_COOKIE, await signAdminToken(admin))
    expect(await readSupportCookie()).toBeNull()
  })

  it('rejects a token signed with another key', async () => {
    const forged = await new SignJWT({ wid: 'ws_a', uid: 'user_1', purpose: 'support' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('adm_1')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('some-other-secret'))
    jar.set(SUPPORT_COOKIE, forged)
    expect(await readSupportCookie()).toBeNull()
  })

  it('cannot be used as an admin session cookie', async () => {
    await startSupportSession(admin, 'ws_a')
    const { getAdminSession } = await import('./admin-auth')
    jar.set('voxility_admin', jar.get(SUPPORT_COOKIE)!)
    expect(await getAdminSession()).toBeNull()
  })
})
