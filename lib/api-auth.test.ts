import { describe, it, expect } from 'vitest'
import { resolveScope, AuthError } from './api-auth'

const wsKey = { scope: 'workspace' as const, workspaceId: 'ws_1' }
const orgKey = { scope: 'org' as const, workspaceId: null }

describe('resolveScope', () => {
  it('workspace key locked to its own workspace', () => {
    expect(resolveScope(wsKey, { requestedWorkspaceId: undefined }))
      .toEqual({ workspaceId: 'ws_1' })
  })

  it('workspace key rejects a different workspaceId (403)', () => {
    expect(() => resolveScope(wsKey, { requestedWorkspaceId: 'ws_2' }))
      .toThrow(AuthError)
    try { resolveScope(wsKey, { requestedWorkspaceId: 'ws_2' }) }
    catch (e) { expect((e as AuthError).status).toBe(403) }
  })

  it('org key scopes down with an explicit workspaceId', () => {
    expect(resolveScope(orgKey, { requestedWorkspaceId: 'ws_9' }))
      .toEqual({ workspaceId: 'ws_9' })
  })

  it('org key on a per-workspace endpoint with no workspaceId → 422', () => {
    try { resolveScope(orgKey, { requestedWorkspaceId: undefined }) }
    catch (e) { expect((e as AuthError).status).toBe(422) }
  })

  it('workspace key forbidden from org endpoints (403)', () => {
    try { resolveScope(wsKey, { orgEndpoint: true }) }
    catch (e) { expect((e as AuthError).status).toBe(403) }
  })

  it('org key allowed on org endpoints', () => {
    expect(resolveScope(orgKey, { orgEndpoint: true })).toEqual({ workspaceId: null })
  })
})
