import { describe, it, expect, beforeAll } from 'vitest'
import { signBridgeParams, verifyBridgeParams, signBridgeRequest, verifyBridgeRequest } from './signing'

beforeAll(() => {
  process.env.GEMINI_VOICE_SIGNING_SECRET = 'a6165077125ee0489b829476cc186c19df4e355ce8b91505c3486e3f59ea1646'
})

describe('signBridgeParams / verifyBridgeParams', () => {
  it('round-trips a payload', () => {
    const exp = Math.floor(Date.now() / 1000) + 60
    const token = signBridgeParams({ agentId: 'agent_123', exp })
    expect(verifyBridgeParams(token)).toEqual({ agentId: 'agent_123', exp })
  })

  it('rejects a tampered token', () => {
    const exp = Math.floor(Date.now() / 1000) + 60
    const token = signBridgeParams({ agentId: 'agent_123', exp })
    const [body, sig] = token.split('.')
    const tampered = `${Buffer.from(JSON.stringify({ agentId: 'agent_evil', exp })).toString('base64url')}.${sig}`
    expect(verifyBridgeParams(tampered)).toBeNull()
    expect(verifyBridgeParams(`${body}.deadbeef`)).toBeNull()
  })

  it('rejects an expired token', () => {
    const exp = Math.floor(Date.now() / 1000) - 1
    const token = signBridgeParams({ agentId: 'agent_123', exp })
    expect(verifyBridgeParams(token)).toBeNull()
  })

  it('rejects a malformed token', () => {
    expect(verifyBridgeParams('not-a-token')).toBeNull()
    expect(verifyBridgeParams('')).toBeNull()
  })
})

describe('signBridgeRequest / verifyBridgeRequest', () => {
  it('round-trips a request body', () => {
    const body = JSON.stringify({ agentId: 'a', name: 'lookupContact', args: {} })
    const header = signBridgeRequest(body)
    expect(verifyBridgeRequest(body, header)).toBe(true)
  })

  it('rejects a wrong signature', () => {
    const body = JSON.stringify({ agentId: 'a' })
    expect(verifyBridgeRequest(body, 'nope')).toBe(false)
    expect(verifyBridgeRequest(body, '')).toBe(false)
  })

  it('rejects a body that does not match the signature', () => {
    const header = signBridgeRequest(JSON.stringify({ agentId: 'a' }))
    expect(verifyBridgeRequest(JSON.stringify({ agentId: 'b' }), header)).toBe(false)
  })
})
