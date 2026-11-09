import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AGENCY_STATE_TTL_MS,
  signAgencyState,
  unverifiedPortalReturn,
  verifyAgencyState,
} from './agency-oauth-state'

const SECRET = 'test-secret'
const NOW = 1_800_000_000_000
const input = {
  widgetId: 'w_victim',
  workspaceId: 'ws_1',
  portalReturn: true,
  actor: { kind: 'portal' as const, portalId: 'p_1', portalUserId: 'pu_1' },
}

describe('agency OAuth state', () => {
  it('round-trips a signed state', () => {
    const raw = signAgencyState(input, SECRET, NOW)
    const r = verifyAgencyState(raw, SECRET, NOW + 1000)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.state.widgetId).toBe('w_victim')
      expect(r.state.actor).toEqual(input.actor)
    }
  })

  it('rejects the old unsigned base64 JSON state (the forgery)', () => {
    const forged = Buffer.from(JSON.stringify({ widgetId: 'w_victim', workspaceId: 'ws_1', portalReturn: true }), 'utf8').toString('base64url')
    expect(verifyAgencyState(forged, SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' })
  })

  it('rejects a state whose payload was swapped for another widget', () => {
    const raw = signAgencyState(input, SECRET, NOW)
    const [, sig] = raw.split('.')
    const other = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(raw.split('.')[0], 'base64url').toString()), widgetId: 'w_other' })).toString('base64url')
    expect(verifyAgencyState(`${other}.${sig}`, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects a state signed with another key', () => {
    const raw = signAgencyState(input, 'attacker-key', NOW)
    expect(verifyAgencyState(raw, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('rejects an expired state', () => {
    const raw = signAgencyState(input, SECRET, NOW)
    expect(verifyAgencyState(raw, SECRET, NOW + AGENCY_STATE_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects garbage', () => {
    for (const bad of [null, '', 'x', 'a.b.c', '.', 'abc.']) {
      expect(verifyAgencyState(bad, SECRET, NOW).ok).toBe(false)
    }
  })

  it('uses a fresh nonce per state', () => {
    expect(signAgencyState(input, SECRET, NOW)).not.toBe(signAgencyState(input, SECRET, NOW))
  })

  it('peeks portalReturn only for routing an error', () => {
    expect(unverifiedPortalReturn(signAgencyState(input, SECRET, NOW))).toBe(true)
    expect(unverifiedPortalReturn('junk')).toBe(false)
  })

  it('the callback verifies state and checks the actor before exchanging the code', () => {
    const src = readFileSync(join(__dirname, '../app/api/auth/leadconnector-agency/callback/route.ts'), 'utf8')
    expect(src).toMatch(/verifyAgencyState\(/)
    expect(src).not.toMatch(/JSON\.parse\(Buffer\.from\(rawState/)
    const check = src.indexOf('actorMayConnectWidget(')
    const exchange = src.indexOf('exchangeAgencyCode(code)')
    expect(check).toBeGreaterThan(-1)
    expect(check).toBeLessThan(exchange)
  })

  it('both install routes sign the state', () => {
    for (const p of ['install', 'portal-install']) {
      const src = readFileSync(join(__dirname, `../app/api/auth/leadconnector-agency/${p}/route.ts`), 'utf8')
      expect(src).toMatch(/signAgencyState\(/)
      expect(src).not.toMatch(/JSON\.stringify\(\{ widgetId/)
    }
  })
})
