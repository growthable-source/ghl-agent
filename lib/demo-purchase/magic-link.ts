/**
 * One-time magic-sign-in link for the post-purchase provisioning flow.
 *
 * Reuses NextAuth's existing (otherwise-unused-by-us) VerificationToken
 * table — no new model, no migration. The raw token is emailed; only its
 * sha256 hash is stored, same pattern the industry standard (and this
 * repo's session-token handling) uses so a DB read alone can't produce a
 * usable link.
 *
 * `identifier` is namespaced `demo-purchase:<userId>:<workspaceId>` so
 * this table can one day carry other token kinds without collision, and
 * so a peek/consume call can recover BOTH the user to sign in and the
 * workspace to land them on directly from the row — no secondary lookup
 * (and no ambiguity if that user is later a member of more than one
 * workspace). userId/workspaceId are both Prisma cuid()s, which never
 * contain a colon, so splitting on ':' is unambiguous.
 *
 * GET /welcome/[token] must be safe for corporate mail-scanners that
 * pre-fetch links — it calls `peekMagicLinkToken`, which validates
 * WITHOUT deleting the row. Only the POST /api/auth/demo-session button
 * click calls `consumeMagicLinkToken`, which single-use-deletes it.
 */
import { randomBytes, createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { sendEmail } from '@/lib/email-send'
import { escapeHtml, paragraphs, renderBrandedEmail } from '@/lib/email-render'

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24h
const IDENTIFIER_PREFIX = 'demo-purchase:'

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/** Mint a fresh one-time token for `userId`/`workspaceId`. Returns the RAW
 *  token — callers must email it immediately; nothing else can recover it
 *  once this function returns (only the hash is persisted). */
export async function createMagicLinkToken(userId: string, workspaceId: string): Promise<string> {
  const raw = randomBytes(32).toString('hex')
  await db.verificationToken.create({
    data: {
      identifier: `${IDENTIFIER_PREFIX}${userId}:${workspaceId}`,
      token: hashToken(raw),
      expires: new Date(Date.now() + TOKEN_TTL_MS),
    },
  })
  return raw
}

export interface MagicLinkValidation {
  ok: boolean
  userId?: string
  workspaceId?: string
  reason?: 'invalid' | 'expired'
}

function parseIdentifier(identifier: string): { userId: string; workspaceId: string } | null {
  if (!identifier.startsWith(IDENTIFIER_PREFIX)) return null
  const rest = identifier.slice(IDENTIFIER_PREFIX.length)
  const idx = rest.indexOf(':')
  if (idx <= 0 || idx === rest.length - 1) return null
  return { userId: rest.slice(0, idx), workspaceId: rest.slice(idx + 1) }
}

/** Validate WITHOUT consuming. Safe to call from a GET (mail-scanner-safe). */
export async function peekMagicLinkToken(raw: string): Promise<MagicLinkValidation> {
  if (!raw) return { ok: false, reason: 'invalid' }
  const record = await db.verificationToken.findUnique({ where: { token: hashToken(raw) } })
  const parsed = record ? parseIdentifier(record.identifier) : null
  if (!record || !parsed) return { ok: false, reason: 'invalid' }
  if (record.expires < new Date()) return { ok: false, reason: 'expired' }
  return { ok: true, userId: parsed.userId, workspaceId: parsed.workspaceId }
}

/**
 * Single-use consume. The `deleteMany` IS the compare-and-swap: `token`
 * is a unique column, so at most one caller's delete can ever match a
 * given row. A racing double-click sees `count === 0` on the loser and
 * must treat the link as already used — it does NOT get to reuse the
 * (still fresh, not-yet-expired) row.
 */
export async function consumeMagicLinkToken(raw: string): Promise<MagicLinkValidation> {
  if (!raw) return { ok: false, reason: 'invalid' }
  const hashed = hashToken(raw)
  const record = await db.verificationToken.findUnique({ where: { token: hashed } })
  const parsed = record ? parseIdentifier(record.identifier) : null
  if (!record || !parsed) return { ok: false, reason: 'invalid' }

  const expired = record.expires < new Date()
  const del = await db.verificationToken.deleteMany({ where: { token: hashed } })
  if (del.count === 0) {
    // Another request (or a second click) already consumed this exact
    // token between our findUnique and our delete.
    return { ok: false, reason: 'invalid' }
  }
  if (expired) return { ok: false, reason: 'expired' }
  return { ok: true, userId: parsed.userId, workspaceId: parsed.workspaceId }
}

/** Branded welcome email carrying the magic link. Model: lib/widget-recovery-email.ts. */
export async function sendMagicLinkEmail(p: { to: string; businessName: string; magicLinkUrl: string }): Promise<void> {
  const { html, text } = renderBrandedEmail({
    title: `${p.businessName} is ready`,
    severity: 'success',
    preheader: `Sign in to see your AI receptionist live in the dashboard.`,
    intro: `Thanks for your purchase! Your AI receptionist for ${p.businessName} is being set up right now.`,
    bodyHtml: paragraphs([
      `Click below to sign in and see it live in your new dashboard.`,
      {
        html: `If the button doesn't work, paste this link into your browser:<br>
               <a href="${escapeHtml(p.magicLinkUrl)}" style="color:#fa4d2e;word-break:break-all;">${escapeHtml(p.magicLinkUrl)}</a>`,
      },
      `This link expires in 24 hours and can only be used once. If you didn't make this purchase, please reply to this email.`,
    ]),
    cta: { label: 'Sign in to your dashboard', url: p.magicLinkUrl },
  })

  await sendEmail({
    to: p.to,
    subject: `You're in — ${p.businessName} is ready`,
    html,
    text,
    context: 'DemoPurchaseMagicLink',
  })
}
