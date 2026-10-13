import { describe, it, expect } from 'vitest'
import { matchScore, rankItems, pageItems, agentItems, conversationItems, contactSearchItem, parseRange, rangeSupport, bellSummary, liveChatCount } from './command-palette'

describe('matchScore / rankItems', () => {
  it('orders prefix < word-start < substring, -1 for none', () => {
    expect(matchScore('te', 'Text agents')).toBe(0)
    expect(matchScore('ag', 'Text agents')).toBe(1)
    expect(matchScore('gen', 'Text agents')).toBe(2)
    expect(matchScore('zzz', 'Text agents')).toBe(-1)
  })
  it('ranks label matches above hint-only matches', () => {
    const items = [{ label: 'Calls', hint: 'Conversations & calls' }, { label: 'Conversations', hint: undefined }]
    expect(rankItems('conv', items).map(i => i.label)).toEqual(['Conversations', 'Calls'])
  })
  it('keeps input order and limit for an empty query', () => {
    expect(rankItems('', [{ label: 'a' }, { label: 'b' }, { label: 'c' }], 2).map(i => i.label)).toEqual(['a', 'b'])
  })
})

describe('items', () => {
  it('omits gated pages unless the gate is open', () => {
    expect(pageItems('w').some(i => i.label === 'Lists')).toBe(false)
    expect(pageItems('w', { 'native-crm': true }).some(i => i.label === 'Lists')).toBe(true)
  })
  it('de-dupes pages by href', () => {
    const hrefs = pageItems('w').map(i => i.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })
  it('routes voice agents to /voice and text agents to /agents', () => {
    const [v, t] = agentItems('w', [{ id: '1', name: 'V', vapiConfig: {} }, { id: '2', name: 'T' }])
    expect(v.href).toBe('/dashboard/w/voice/1')
    expect(t.href).toBe('/dashboard/w/agents/2')
  })
  it('labels anonymous conversations and encodes meta ids', () => {
    const [c] = conversationItems('w', [{ id: 'meta:9', visitor: null }])
    expect(c.label).toBe('Anonymous visitor')
    expect(c.href).toBe('/dashboard/w/inbox/meta%3A9')
  })
  it('contact search needs 2+ chars and encodes the query', () => {
    expect(contactSearchItem('w', 'a')).toBeNull()
    expect(contactSearchItem('w', 'jo & co')?.href).toBe('/dashboard/w/contacts?q=jo%20%26%20co')
  })
})

describe('range + bell', () => {
  it('parses unknown ranges to 7d', () => {
    expect(parseRange('30d')).toBe('30d')
    expect(parseRange('1y')).toBe('7d')
    expect(parseRange(null)).toBe('7d')
  })
  it('range support: dashboard enabled, insights/activity disabled, others hidden', () => {
    expect(rangeSupport('')).toBe('enabled')
    expect(rangeSupport('/insights')).toBe('disabled')
    expect(rangeSupport('/activity')).toBe('disabled')
    expect(rangeSupport('/inbox')).toBe('hidden')
    expect(rangeSupport(null)).toBe('hidden')
  })
  it('bell counts attention + approvals and handles empty', () => {
    expect(bellSummary(null, 'w')).toEqual({ items: [], count: 0 })
    const s = bellSummary({ attention: { items: [{ label: 'Agent paused', agent: { name: 'A' }, reason: 'x' }] }, approvals: { count: 2 } }, 'w')
    expect(s.count).toBe(3)
    expect(s.items[0].key).toBe('approvals')
  })
  it('live count', () => {
    expect(liveChatCount({ recent: { chats: [1, 2] } })).toBe(2)
    expect(liveChatCount(null)).toBe(0)
  })
})
