/**
 * Signed `state` for the agency-level LeadConnector OAuth
 * (/api/auth/leadconnector-agency/{install,portal-install,callback}).
 *
 * The state used to be plain base64 JSON naming a widget and workspace,
 * and the callback trusted it. Anyone could build a state naming another
 * customer's widget, finish the OAuth with their own agency, and overwrite
 * that widget's AgencyConnection. Now the state is HMAC-signed, expires,
 * and names WHO started the flow; the callback re-checks that actor's
 * CURRENT access to the widget in the DB (lib/agency-oauth-authority.ts).
 *
 * The callback runs on APP_URL while install can run on a whitelabel host,
 * so the check deliberately does not depend on a cookie at the callback.
 *
 * Pure (no Prisma, no env reads in the core functions) so it unit-tests.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const AGENCY_STATE_TTL_MS = 15 * 60 * 1000

export type AgencyOAuthActor =
  | { kind: 'user'; userId: string }
  // portalUserId is 'admin-preview' for a super-admin portal preview
  // session (lib/portal-auth.ts), which has no PortalUser row.
  | { kind: 'portal'; portalId: string; portalUserId: string }

export interface AgencyOAuthState {
  v: 2
  widgetId: string
  workspaceId: string
  portalReturn: boolean
  actor: AgencyOAuthActor
  nonce: string
  exp: number
}

export type VerifyResult =
  | { ok: true; state: AgencyOAuthState }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' }

function mac(payload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(payload).digest()
}

export function signAgencyState(
  input: Omit<AgencyOAuthState, 'v' | 'nonce' | 'exp'>,
  secret: string,
  now: number = Date.now(),
): string {
  const state: AgencyOAuthState = {
    v: 2,
    ...input,
    nonce: randomBytes(16).toString('base64url'),
    exp: now + AGENCY_STATE_TTL_MS,
  }
  const payload = Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
  return `${payload}.${mac(payload, secret).toString('base64url')}`
}

function isActor(a: unknown): a is AgencyOAuthActor {
  if (!a || typeof a !== 'object') return false
  const o = a as Record<string, unknown>
  if (o.kind === 'user') return typeof o.userId === 'string' && o.userId.length > 0
  if (o.kind === 'portal') {
    return typeof o.portalId === 'string' && o.portalId.length > 0
      && typeof o.portalUserId === 'string' && o.portalUserId.length > 0
  }
  return false
}

export function verifyAgencyState(raw: string | null | undefined, secret: string, now: number = Date.now()): VerifyResult {
  if (!raw || typeof raw !== 'string') return { ok: false, reason: 'malformed' }
  const parts = raw.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' }
  const [payload, sig] = parts
  const expected = mac(payload, secret)
  let given: Buffer
  try {
    given = Buffer.from(sig, 'base64url')
  } catch {
    return { ok: false, reason: 'bad_signature' }
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad_signature' }
  }
  let s: Record<string, unknown>
  try {
    s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!s || s.v !== 2
      || typeof s.widgetId !== 'string' || !s.widgetId
      || typeof s.workspaceId !== 'string' || !s.workspaceId
      || typeof s.portalReturn !== 'boolean'
      || typeof s.nonce !== 'string' || typeof s.exp !== 'number'
      || !isActor(s.actor)) {
    return { ok: false, reason: 'malformed' }
  }
  if (now > s.exp) return { ok: false, reason: 'expired' }
  return { ok: true, state: s as unknown as AgencyOAuthState }
}

/**
 * Best-effort read of `portalReturn` from a state that FAILED
 * verification, only to pick which page the error redirect lands on.
 * Never use it for anything else.
 */
export function unverifiedPortalReturn(raw: string | null | undefined): boolean {
  try {
    const payload = (raw ?? '').split('.')[0]
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))?.portalReturn === true
  } catch {
    return false
  }
}

/**
 * Signing key. LEADCONNECTOR_AGENCY_STATE_SECRET when set; otherwise a
 * key derived from the agency client secret (server-only, and always set
 * when agency OAuth is configured), so no new env var is needed to deploy.
 */
export function agencyStateSecret(): string | null {
  const explicit = process.env.LEADCONNECTOR_AGENCY_STATE_SECRET
  if (explicit) return explicit
  const client = process.env.LEADCONNECTOR_AGENCY_CLIENT_SECRET
  if (!client) return null
  return createHmac('sha256', client).update('leadconnector-agency-oauth-state.v2').digest('base64url')
}
