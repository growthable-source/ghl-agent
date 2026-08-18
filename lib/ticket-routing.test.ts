import { describe, expect, it } from 'vitest'
import { pickTicketAssignee, type TicketRoutingConfig } from './ticket-routing'

function config(overrides: Partial<TicketRoutingConfig>): TicketRoutingConfig {
  return {
    mode: 'manual',
    singleUserId: null,
    poolUserIds: [],
    lastAssignedUserId: null,
    ...overrides,
  }
}

const TEAM = ['user-a', 'user-b', 'user-c']

describe('pickTicketAssignee — manual', () => {
  it('never picks anyone', () => {
    expect(pickTicketAssignee(config({}), TEAM)).toBeNull()
  })
})

describe('pickTicketAssignee — single', () => {
  it('picks the designated assignee when they are eligible', () => {
    expect(pickTicketAssignee(config({ mode: 'single', singleUserId: 'user-b' }), TEAM))
      .toEqual({ userId: 'user-b', reason: 'single' })
  })

  it('returns null when the assignee left the workspace or was demoted', () => {
    expect(pickTicketAssignee(config({ mode: 'single', singleUserId: 'user-gone' }), TEAM)).toBeNull()
  })

  it('returns null when no assignee is configured', () => {
    expect(pickTicketAssignee(config({ mode: 'single' }), TEAM)).toBeNull()
  })
})

describe('pickTicketAssignee — pool', () => {
  it('empty pool list means everyone eligible', () => {
    const pick = pickTicketAssignee(config({ mode: 'pool' }), TEAM)
    expect(pick).toEqual({ userId: 'user-a', reason: 'pool_round_robin' })
  })

  it('rotates round-robin from the cursor', () => {
    expect(pickTicketAssignee(config({ mode: 'pool', lastAssignedUserId: 'user-a' }), TEAM)?.userId).toBe('user-b')
    expect(pickTicketAssignee(config({ mode: 'pool', lastAssignedUserId: 'user-b' }), TEAM)?.userId).toBe('user-c')
  })

  it('wraps around after the last member', () => {
    expect(pickTicketAssignee(config({ mode: 'pool', lastAssignedUserId: 'user-c' }), TEAM)?.userId).toBe('user-a')
  })

  it('restricts to the configured pool, ignoring configured ids who are no longer members', () => {
    const c = config({ mode: 'pool', poolUserIds: ['user-c', 'user-gone'] })
    expect(pickTicketAssignee(c, TEAM)?.userId).toBe('user-c')
  })

  it('returns null when every configured pool member is stale', () => {
    const c = config({ mode: 'pool', poolUserIds: ['ghost-1', 'ghost-2'] })
    expect(pickTicketAssignee(c, TEAM)).toBeNull()
  })

  it('returns null when the workspace has no eligible members at all', () => {
    expect(pickTicketAssignee(config({ mode: 'pool' }), [])).toBeNull()
  })

  it('restarts from the front when the cursor user left the pool', () => {
    const c = config({ mode: 'pool', poolUserIds: ['user-b', 'user-c'], lastAssignedUserId: 'user-a' })
    expect(pickTicketAssignee(c, TEAM)?.userId).toBe('user-b')
  })

  it('is deterministic regardless of eligible-list order', () => {
    const shuffled = ['user-c', 'user-a', 'user-b']
    expect(pickTicketAssignee(config({ mode: 'pool' }), shuffled)?.userId).toBe('user-a')
    expect(pickTicketAssignee(config({ mode: 'pool', lastAssignedUserId: 'user-a' }), shuffled)?.userId).toBe('user-b')
  })
})
