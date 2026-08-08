/**
 * One-time SSO token for the customer's client portal.
 *
 * The partner already authenticated this person, so making them find an
 * invite email and set a password before seeing their first CSAT number
 * is pure funnel loss. The partner mints a token through the (org-key
 * authenticated) provisioning API, sends the customer to
 * /portal/sso?t=<token>, and redemption signs them straight into a real
 * portal session — creating their PortalUser on first use, invite step
 * skipped entirely.
 *
 * Same storage scheme as builder-token.ts (NextAuth's otherwise-unused
 * VerificationToken table, sha256 at rest, deleteMany compare-and-swap
 * for single use), different identifier namespace so the kinds cannot
 * collide.
 */
import { randomBytes, createHash } from 'node:crypto'
import { db } from '@/lib/db'

const TOKEN_TTL_MS = 10 * 60 * 1000
const IDENTIFIER_PREFIX = 'partner-portal:'

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * Mint a portal SSO token. Returns the RAW value; only the hash is stored.
 *
 * The email is base64url-wrapped inside the identifier because emails may
 * contain ':' while cuids never do — the portalId splits unambiguously.
 */
export async function createPortalSsoToken(portalId: string, email: string): Promise<string> {
  const raw = randomBytes(32).toString('hex')
  await db.verificationToken.create({
    data: {
      identifier: `${IDENTIFIER_PREFIX}${portalId}:${Buffer.from(email.toLowerCase()).toString('base64url')}`,
      token: hashToken(raw),
      expires: new Date(Date.now() + TOKEN_TTL_MS),
    },
  })
  return raw
}

export interface PortalSsoValidation {
  ok: boolean
  portalId?: string
  email?: string
  reason?: 'invalid' | 'expired'
}

/** Redeem exactly once. The deleteMany on the unique token column is the
 *  compare-and-swap: two racing redemptions cannot both see count 1. */
export async function consumePortalSsoToken(raw: string): Promise<PortalSsoValidation> {
  const hashed = hashToken(raw)
  const row = await db.verificationToken.findUnique({ where: { token: hashed } })
  if (!row || !row.identifier.startsWith(IDENTIFIER_PREFIX)) return { ok: false, reason: 'invalid' }

  const deleted = await db.verificationToken.deleteMany({ where: { token: hashed } })
  if (deleted.count === 0) return { ok: false, reason: 'invalid' }
  if (row.expires.getTime() < Date.now()) return { ok: false, reason: 'expired' }

  const bare = row.identifier.slice(IDENTIFIER_PREFIX.length)
  const splitAt = bare.indexOf(':')
  if (splitAt <= 0) return { ok: false, reason: 'invalid' }
  const portalId = bare.slice(0, splitAt)
  let email: string
  try {
    email = Buffer.from(bare.slice(splitAt + 1), 'base64url').toString('utf8')
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (!portalId || !email) return { ok: false, reason: 'invalid' }
  return { ok: true, portalId, email }
}
