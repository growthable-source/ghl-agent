import { describe, it, expect } from 'vitest'
import { agentMayCallApi, agentMayOpenPage } from './access-policy'
import { signRequestPath, verifyRequestPath } from './request-path'

describe('agentMayCallApi', () => {
  it('allows the inbox and ticket work', () => {
    expect(agentMayCallApi('/api/workspaces/ws1/widget-conversations/c1/messages', 'POST')).toBe(true)
    expect(agentMayCallApi('/api/workspaces/ws1/tickets/t1', 'PATCH')).toBe(true)
    expect(agentMayCallApi('/api/workspaces/ws1/me/presence', 'POST')).toBe(true)
    expect(agentMayCallApi('/api/workspaces/ws1/takeover', 'POST')).toBe(true)
  })

  it('allows read-only context but not writes to it', () => {
    expect(agentMayCallApi('/api/workspaces/ws1/members', 'GET')).toBe(true)
    expect(agentMayCallApi('/api/workspaces/ws1/members', 'POST')).toBe(false)
    expect(agentMayCallApi('/api/workspaces/ws1/settings/ticketing', 'GET')).toBe(true)
    expect(agentMayCallApi('/api/workspaces/ws1/settings/ticketing', 'PUT')).toBe(false)
    expect(agentMayCallApi('/api/workspaces/ws1/domain', 'PUT')).toBe(false)
    expect(agentMayCallApi('/api/workspaces/ws1', 'GET')).toBe(true)
    expect(agentMayCallApi('/api/workspaces/ws1', 'PATCH')).toBe(false)
  })

  it('denies configuration surfaces', () => {
    expect(agentMayCallApi('/api/workspaces/ws1/agents', 'GET')).toBe(false)
    expect(agentMayCallApi('/api/workspaces/ws1/agents/a1', 'PATCH')).toBe(false)
    expect(agentMayCallApi('/api/workspaces/ws1/knowledge', 'POST')).toBe(false)
    expect(agentMayCallApi('/api/workspaces/ws1/invites', 'POST')).toBe(false)
    expect(agentMayCallApi('/api/agents/a1', 'GET')).toBe(false)
  })

  it('ignores the query string', () => {
    expect(agentMayCallApi('/api/workspaces/ws1/tickets?status=open', 'GET')).toBe(true)
    expect(agentMayCallApi('/api/workspaces/ws1/agents?x=/tickets', 'GET')).toBe(false)
  })
})

describe('agentMayOpenPage', () => {
  it('allows inbox and tickets only', () => {
    expect(agentMayOpenPage('/dashboard/ws1/inbox')).toBe(true)
    expect(agentMayOpenPage('/dashboard/ws1/inbox/c1')).toBe(true)
    expect(agentMayOpenPage('/dashboard/ws1/tickets/t1')).toBe(true)
    expect(agentMayOpenPage('/dashboard/ws1')).toBe(false)
    expect(agentMayOpenPage('/dashboard/ws1/agents')).toBe(false)
    expect(agentMayOpenPage('/dashboard/ws1/settings/domain')).toBe(false)
  })
})

describe('signed request path', () => {
  it('verifies only the exact path + method it was signed for', async () => {
    const sig = await signRequestPath('/api/workspaces/ws1/tickets', 'GET', 'secret')
    expect(await verifyRequestPath('/api/workspaces/ws1/tickets', 'GET', sig, 'secret')).toBe(true)
    expect(await verifyRequestPath('/api/workspaces/ws1/tickets', 'get', sig, 'secret')).toBe(true)
    expect(await verifyRequestPath('/api/workspaces/ws1/agents', 'GET', sig, 'secret')).toBe(false)
    expect(await verifyRequestPath('/api/workspaces/ws1/tickets', 'POST', sig, 'secret')).toBe(false)
    expect(await verifyRequestPath('/api/workspaces/ws1/tickets', 'GET', sig, 'other')).toBe(false)
  })

  it('fails closed on anything missing', async () => {
    expect(await verifyRequestPath('/x', 'GET', null, 'secret')).toBe(false)
    expect(await verifyRequestPath('/x', 'GET', 'abc', undefined)).toBe(false)
    expect(await verifyRequestPath(null, 'GET', 'abc', 'secret')).toBe(false)
  })
})
