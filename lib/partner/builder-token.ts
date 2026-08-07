/**
 * One-time SSO token for the embedded widget builder.
 *
 * The partner's admin UI iframes our builder. It gets a fresh token per
 * open (minted through the provisioning API, which is already
 * authenticated by an org API key), the iframe posts it to the handshake
 * endpoint, and the handshake mints a real session cookie.
 *
 * Same storage trick as lib/demo-purchase/magic-link.ts: NextAuth's
 * otherwise-unused VerificationToken table, only the sha256 hash at rest,
 * single-use via a `deleteMany` compare-and-swap on the unique `token`
 * column. Namespaced identifier so the two token kinds can't collide.
 *
 * Deliberately NOT modelled on the LeadConnector iframe handshake. That
 * scheme is MD5-EVP-derived AES-CBC with no timestamp, no nonce and no
 * replay protection — inherited from the CRM and kept for compatibility,
 * not a pattern to propagate into new surface area.
 *
 * TTL is 10 minutes, not 24 hours: the token is handed machine-to-machine
 * and redeemed immediately, so there is no reason for it to outlive the
 * page load. Nothing long-lived exists to leak.
 */
import { randomBytes, createHash } from 'node:crypto'
import { db } from '@/lib/db'

const TOKEN_TTL_MS = 10 * 60 * 1000
const IDENTIFIER_PREFIX = 'partner-builder:'

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * Mint a builder token. Returns the RAW value — only its hash is stored,
 * so nothing can recover it after this returns.
 *
 * userId and workspaceId are both cuid()s (never contain a colon), and
 * widgetId is appended last, so splitting the identifier is unambiguous.
 */
export async function createBuilderToken(
  userId: string,
  workspaceId: string,
  widgetId: string,
): Promise<string> {
  const raw = randomBytes(32).toString('hex')
  await db.verificationToken.create({
    data: {
      identifier: `${IDENTIFIER_PREFIX}${userId}:${workspaceId}:${widgetId}`,
      token: hashToken(raw),
      expires: new Date(Date.now() + TOKEN_TTL_MS),
    },
  })
  return raw
}

export interface BuilderTokenValidation {
  ok: boolean
  userId?: string
  workspaceId?: string
  widgetId?: string
  reason?: 'invalid' | 'expired'
}

function parseIdentifier(identifier: string): Omit<BuilderTokenValidation, 'ok' | 'reason'> | null {
  if (!identifier.startsWith(IDENTIFIER_PREFIX)) return null
  const parts = identifier.slice(IDENTIFIER_PREFIX.length).split(':')
  if (parts.length !== 3 || parts.some(p => !p)) return null
  return { userId: parts[0], workspaceId: parts[1], widgetId: parts[2] }
}

/**
 * Single-use consume. The `deleteMany` IS the compare-and-swap: `token`
 * is unique, so at most one caller's delete can match a given row. A
 * racing second redemption sees `count === 0` and must treat the token as
 * spent — it does not get to reuse a still-fresh row.
 */
export async function consumeBuilderToken(raw: string): Promise<BuilderTokenValidation> {
  if (!raw) return { ok: false, reason: 'invalid' }
  const hashed = hashToken(raw)
  const record = await db.verificationToken.findUnique({ where: { token: hashed } })
  const parsed = record ? parseIdentifier(record.identifier) : null
  if (!record || !parsed) return { ok: false, reason: 'invalid' }

  const expired = record.expires < new Date()
  const deleted = await db.verificationToken.deleteMany({ where: { token: hashed } })
  if (deleted.count === 0) return { ok: false, reason: 'invalid' }
  if (expired) return { ok: false, reason: 'expired' }

  return { ok: true, ...parsed }
}
