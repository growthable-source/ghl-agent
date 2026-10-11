import { beforeEach, describe, expect, it, vi } from 'vitest'

const dbMock = vi.hoisted(() => ({
  workspace: { findUnique: vi.fn() },
  workspaceDomain: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  portal: { findUnique: vi.fn() },
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))

const vercel = vi.hoisted(() => ({
  addProjectDomain: vi.fn(),
  getProjectDomain: vi.fn(),
  verifyProjectDomain: vi.fn(),
  isDomainMisconfigured: vi.fn(),
  removeProjectDomain: vi.fn(),
}))
vi.mock('./vercel', async () => {
  const actual = await vi.importActual<typeof import('./vercel')>('./vercel')
  return { ...actual, ...vercel }
})

import {
  addWorkspaceDomain,
  DomainError,
  hostMayServeWorkspace,
  invalidateHostCache,
  refreshWorkspaceDomain,
  resolveWorkspaceIdForHost,
} from './workspace-domain'
import { VercelError } from './vercel'

const unlockedWs = { whitelabelUnlocked: true, whitelabelDomain: null }
const rowFor = (over = {}) => ({
  id: 'd1', workspaceId: 'ws1', hostname: 'live.acme.com', status: 'pending', dnsRecords: [],
  lastError: null, lastCheckedAt: null, verifiedAt: null, createdAt: new Date(), ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  invalidateHostCache()
  dbMock.workspace.findUnique.mockResolvedValue(unlockedWs)
  dbMock.workspaceDomain.findUnique.mockResolvedValue(null)
  dbMock.portal.findUnique.mockResolvedValue(null)
  vercel.getProjectDomain.mockResolvedValue(null)
  vercel.addProjectDomain.mockResolvedValue({ name: 'live.acme.com', verified: true, verification: [] })
  vercel.removeProjectDomain.mockResolvedValue(undefined)
  dbMock.workspaceDomain.create.mockImplementation(async ({ data }) => rowFor(data))
})

describe('addWorkspaceDomain', () => {
  it('refuses while the workspace is locked', async () => {
    dbMock.workspace.findUnique.mockResolvedValue({ whitelabelUnlocked: false, whitelabelDomain: null })
    await expect(addWorkspaceDomain('ws1', 'live.acme.com')).rejects.toMatchObject({ code: 'locked' })
    expect(vercel.addProjectDomain).not.toHaveBeenCalled()
  })

  it('rejects apex domains before touching Vercel', async () => {
    await expect(addWorkspaceDomain('ws1', 'acme.com')).rejects.toMatchObject({ code: 'invalid' })
    expect(vercel.addProjectDomain).not.toHaveBeenCalled()
  })

  it('rejects a host already used by a portal', async () => {
    dbMock.portal.findUnique.mockResolvedValue({ id: 'p1' })
    await expect(addWorkspaceDomain('ws1', 'live.acme.com')).rejects.toMatchObject({ code: 'taken' })
  })

  it('creates the row and reports the CNAME to add', async () => {
    const v = await addWorkspaceDomain('ws1', 'live.acme.com')
    expect(v.status).toBe('pending')
    expect(v.dnsRecords[0]).toMatchObject({ type: 'CNAME', name: 'live.acme.com' })
  })

  it('rolls the domain back off Vercel when the DB insert fails', async () => {
    dbMock.workspaceDomain.create.mockRejectedValue(new Error('db down'))
    await expect(addWorkspaceDomain('ws1', 'live.acme.com')).rejects.toThrow('db down')
    expect(vercel.removeProjectDomain).toHaveBeenCalledWith('live.acme.com')
  })

  it('maps a lost unique-constraint race to "taken" and rolls back', async () => {
    dbMock.workspaceDomain.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }))
    await expect(addWorkspaceDomain('ws1', 'live.acme.com')).rejects.toMatchObject({ code: 'taken' })
    expect(vercel.removeProjectDomain).toHaveBeenCalled()
  })

  it('adopts a domain already on our project and never removes what it did not add', async () => {
    vercel.getProjectDomain.mockResolvedValue({ name: 'live.acme.com', verified: true, verification: [] })
    dbMock.workspaceDomain.create.mockRejectedValue(new Error('db down'))
    await expect(addWorkspaceDomain('ws1', 'live.acme.com')).rejects.toThrow('db down')
    expect(vercel.addProjectDomain).not.toHaveBeenCalled()
    expect(vercel.removeProjectDomain).not.toHaveBeenCalled()
  })

  it('does not leak Vercel error text to the caller', async () => {
    vercel.addProjectDomain.mockRejectedValue(new VercelError('internal_error', 'secret upstream detail', 500))
    const err = await addWorkspaceDomain('ws1', 'live.acme.com').catch(e => e)
    expect(err).toBeInstanceOf(DomainError)
    expect(err.message).not.toContain('secret upstream detail')
  })
})

describe('refreshWorkspaceDomain', () => {
  it('does not call Vercel for a locked workspace', async () => {
    dbMock.workspaceDomain.findUnique.mockResolvedValue({ ...rowFor(), workspace: { whitelabelUnlocked: false } })
    await refreshWorkspaceDomain('ws1')
    expect(vercel.getProjectDomain).not.toHaveBeenCalled()
    expect(vercel.addProjectDomain).not.toHaveBeenCalled()
  })

  it('goes active once Vercel reports verified and correctly pointed', async () => {
    dbMock.workspaceDomain.findUnique.mockResolvedValue({ ...rowFor(), workspace: { whitelabelUnlocked: true } })
    vercel.getProjectDomain.mockResolvedValue({ name: 'live.acme.com', verified: true, verification: [] })
    vercel.isDomainMisconfigured.mockResolvedValue(false)
    dbMock.workspaceDomain.update.mockImplementation(async ({ data }) => rowFor(data))
    expect((await refreshWorkspaceDomain('ws1'))?.status).toBe('active')
  })

  it('gives up (status error) when DNS never appears for 7+ days', async () => {
    const old = new Date(Date.now() - 8 * 86_400_000)
    dbMock.workspaceDomain.findUnique.mockResolvedValue({ ...rowFor({ createdAt: old }), workspace: { whitelabelUnlocked: true } })
    vercel.getProjectDomain.mockResolvedValue({ name: 'live.acme.com', verified: true, verification: [] })
    vercel.isDomainMisconfigured.mockResolvedValue(true)
    dbMock.workspaceDomain.update.mockImplementation(async ({ data }) => rowFor(data))
    expect((await refreshWorkspaceDomain('ws1'))?.status).toBe('error')
  })
})

describe('host gating', () => {
  it('never queries the DB for primary hosts', async () => {
    for (const h of ['app.xovera.io', 'app.voxility.ai', 'widget.xovera.io']) {
      expect(await hostMayServeWorkspace(h, 'ws1')).toBe(true)
    }
    expect(dbMock.workspaceDomain.findUnique).not.toHaveBeenCalled()
  })

  it('allows unknown hosts (e.g. a runtime project) instead of 404ing them', async () => {
    expect(await hostMayServeWorkspace('copilot-runtime.example.net', 'ws1')).toBe(true)
  })

  it('confines a registered host to its own workspace', async () => {
    dbMock.workspaceDomain.findUnique.mockResolvedValue({
      status: 'active', workspaceId: 'ws1', workspace: { whitelabelUnlocked: true },
    })
    expect(await hostMayServeWorkspace('live.acme.com', 'ws1')).toBe(true)
    expect(await hostMayServeWorkspace('live.acme.com', 'ws2')).toBe(false)
    expect(await resolveWorkspaceIdForHost('live.acme.com')).toBe('ws1')
  })

  it('stops serving once the workspace is re-locked and the cache is cleared', async () => {
    dbMock.workspaceDomain.findUnique.mockResolvedValue({
      status: 'active', workspaceId: 'ws1', workspace: { whitelabelUnlocked: true },
    })
    expect(await hostMayServeWorkspace('live.acme.com', 'ws1')).toBe(true)
    dbMock.workspaceDomain.findUnique.mockResolvedValue({
      status: 'active', workspaceId: 'ws1', workspace: { whitelabelUnlocked: false },
    })
    invalidateHostCache()
    expect(await hostMayServeWorkspace('live.acme.com', 'ws1')).toBe(false)
  })
})
