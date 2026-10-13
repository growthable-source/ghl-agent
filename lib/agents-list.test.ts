import { describe, it, expect } from 'vitest'
import { getListeningState, rowChannels, filterAndSort, agentKpis, channelsInUse, initials, timeAgo, type ListAgent } from './agents-list'

const mk = (o: Partial<ListAgent> & { name: string }): ListAgent => ({
  id: o.name, isActive: true, updatedAt: '2026-10-01T00:00:00Z', channelDeployments: [{ channel: 'SMS' }],
  _count: { routingRules: 1, conversationStates: 0, messageLogs: 0 }, ...o,
})

describe('getListeningState', () => {
  it('off / misconfigured / live', () => {
    expect(getListeningState(mk({ name: 'a', isActive: false })).state).toBe('off')
    expect(getListeningState(mk({ name: 'a', _count: { routingRules: 0, conversationStates: 0, messageLogs: 0 } })).state).toBe('misconfigured')
    expect(getListeningState(mk({ name: 'a', channelDeployments: [] })).reason).toContain('channel deployment')
    expect(getListeningState(mk({ name: 'a' })).state).toBe('live')
  })
})

describe('rowChannels', () => {
  it('maps, de-dupes, drops unknown, appends bolted-on voice', () => {
    const a = mk({ name: 'a', channelDeployments: [{ channel: 'SMS' }, { channel: 'SMS' }, { channel: 'Live_Chat' }, { channel: 'XYZ' }], vapiConfig: { isActive: true } })
    expect(rowChannels(a)).toEqual(['sms', 'chat', 'voice'])
    expect(rowChannels(mk({ name: 'v', agentType: 'VOICE', channelDeployments: [] }))).toEqual(['voice'])
  })
})

describe('filterAndSort', () => {
  const agents = [
    mk({ name: 'Zed', updatedAt: '2026-10-02T00:00:00Z', _count: { routingRules: 1, conversationStates: 5, messageLogs: 0 } }),
    mk({ name: 'Amy', isActive: false, channelDeployments: [{ channel: 'WhatsApp' }], updatedAt: '2026-10-03T00:00:00Z' }),
    mk({ name: 'Bob', updatedAt: '2026-10-01T00:00:00Z', _count: { routingRules: 1, conversationStates: 9, messageLogs: 0 } }),
  ]
  const base = { query: '', status: 'any', channel: 'any', sort: 'updated' } as const
  it('sorts', () => {
    expect(filterAndSort(agents, base).map(a => a.name)).toEqual(['Amy', 'Zed', 'Bob'])
    expect(filterAndSort(agents, { ...base, sort: 'name' }).map(a => a.name)).toEqual(['Amy', 'Bob', 'Zed'])
    expect(filterAndSort(agents, { ...base, sort: 'conversations' })[0].name).toBe('Bob')
  })
  it('filters by query, status and channel', () => {
    expect(filterAndSort(agents, { ...base, query: 'ze' }).map(a => a.name)).toEqual(['Zed'])
    expect(filterAndSort(agents, { ...base, status: 'off' }).map(a => a.name)).toEqual(['Amy'])
    expect(filterAndSort(agents, { ...base, channel: 'whatsapp' }).map(a => a.name)).toEqual(['Amy'])
  })
  it('kpis + channelsInUse', () => {
    expect(agentKpis(agents)).toMatchObject({ total: 3, live: 2, needAttention: 0, conversations: 14 })
    expect(channelsInUse(agents).sort()).toEqual(['sms', 'whatsapp'])
  })
})

describe('misc', () => {
  it('initials', () => { expect(initials('Growthable Inbound Agent')).toBe('GI'); expect(initials('')).toBe('?') })
  it('timeAgo', () => {
    const now = Date.parse('2026-10-13T12:00:00Z')
    expect(timeAgo('2026-10-13T11:58:00Z', now)).toBe('2m ago')
    expect(timeAgo('2026-10-13T09:00:00Z', now)).toBe('3h ago')
  })
})
