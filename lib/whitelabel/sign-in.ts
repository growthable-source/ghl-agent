/**
 * DB side of the white-label team sign-in (app/sign-in, app/api/sign-in/*).
 * Pure pieces live in ./login-code.ts.
 *
 * Who can get a code: a member of the workspace that owns the request
 * host, or someone with a pending, unexpired invite to it. Anyone else
 * gets the same "if you have an account, we sent a code" answer, so the
 * page can't be used to discover who works for the customer.
 *
 * A successful code mints a normal NextAuth database session (same shape
 * as the kiosk and iframe handshakes), cookie host-only on the customer's
 * domain. A pending invite is accepted at that moment — the code proved
 * the invitee owns the mailbox, which is what the Google flow at
 * /invite/[token] proves on our own host.
 */

import { randomBytes } from 'node:crypto'
import { db } from '@/lib/db'
import { renderBrandedEmail, escapeHtml } from '@/lib/email-render'
import { sendEmail } from '@/lib/email-send'
import type { TeamBrand } from '@/lib/domains/host-brand'
import {
  brandedFromAddress, codeMatches, codeState, CODE_TTL_MINUTES, generateLoginCode, hashLoginCode,
  MAX_CODES_PER_EMAIL, MAX_CODES_PER_IP, RATE_WINDOW_MINUTES,
} from './login-code'

export const SESSION_DAYS = 30
export const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60

function secret(): string {
  const s = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!s) throw new Error('AUTH_SECRET / NEXTAUTH_SECRET must be set for team sign-in')
  return s
}

async function findUserByEmail(email: string) {
  return db.user.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true },
  })
}

async function pendingInvite(workspaceId: string, email: string) {
  return db.workspaceInvite.findFirst({
    where: {
      workspaceId,
      email: { equals: email, mode: 'insensitive' },
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, role: true },
  })
}

async function isEligible(workspaceId: string, email: string): Promise<boolean> {
  const user = await findUserByEmail(email)
  if (user) {
    const member = await db.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId } },
      select: { id: true },
    })
    if (member) return true
  }
  return !!(await pendingInvite(workspaceId, email))
}

export type RequestCodeResult = 'sent' | 'not_eligible' | 'rate_limited'

/** Issue + email a code. Callers show the same message for sent/not_eligible. */
export async function requestLoginCode(brand: TeamBrand, email: string, ip: string | null): Promise<RequestCodeResult> {
  const since = new Date(Date.now() - RATE_WINDOW_MINUTES * 60_000)
  const [forEmail, forIp] = await Promise.all([
    db.workspaceLoginCode.count({ where: { workspaceId: brand.workspaceId, email, createdAt: { gte: since } } }),
    ip ? db.workspaceLoginCode.count({ where: { ip, createdAt: { gte: since } } }) : Promise.resolve(0),
  ])
  if (forEmail >= MAX_CODES_PER_EMAIL || forIp >= MAX_CODES_PER_IP) return 'rate_limited'
  if (!(await isEligible(brand.workspaceId, email))) return 'not_eligible'

  const code = generateLoginCode()
  // A new code supersedes any earlier unused one for this person.
  await db.workspaceLoginCode.updateMany({
    where: { workspaceId: brand.workspaceId, email, consumedAt: null },
    data: { consumedAt: new Date() },
  })
  await db.workspaceLoginCode.create({
    data: {
      workspaceId: brand.workspaceId,
      email,
      codeHash: hashLoginCode(code, brand.workspaceId, email, secret()),
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
      ip,
    },
  })

  const { html, text } = renderBrandedEmail({
    title: `Your ${brand.name} sign-in code`,
    preheader: `${code} is your sign-in code. It expires in ${CODE_TTL_MINUTES} minutes.`,
    bodyHtml: `
      <p style="margin:0 0 12px;">Enter this code on the sign-in page:</p>
      <p style="margin:0 0 16px;font-size:30px;font-weight:700;letter-spacing:6px;font-family:ui-monospace,Menlo,monospace;color:#111827;">${escapeHtml(code)}</p>
      <p style="margin:0;">It expires in ${CODE_TTL_MINUTES} minutes and works once. If you didn't try to sign in, you can ignore this email.</p>`,
    brand: { name: brand.name, accent: brand.accent },
  })
  const platformFrom = process.env.NOTIFICATION_FROM_EMAIL || 'notifications@xovera.io'
  await sendEmail({
    to: email,
    subject: `${code} is your ${brand.name} sign-in code`,
    html,
    text,
    from: brandedFromAddress(brand.name, platformFrom),
    context: 'TeamSignIn',
  })
  return 'sent'
}

export type VerifyCodeResult =
  | { ok: true; userId: string; role: string }
  | { ok: false; error: 'invalid' | 'expired' | 'no_access' }

/** Check a code; on success make sure the person is a member and return who they are. */
export async function verifyLoginCode(workspaceId: string, email: string, code: string): Promise<VerifyCodeResult> {
  const row = await db.workspaceLoginCode.findFirst({
    where: { workspaceId, email },
    orderBy: { createdAt: 'desc' },
    select: { id: true, codeHash: true, attempts: true, expiresAt: true, consumedAt: true },
  })
  if (!row) return { ok: false, error: 'invalid' }
  const state = codeState(row)
  if (state !== 'usable') return { ok: false, error: state === 'expired' ? 'expired' : 'invalid' }

  if (!codeMatches(code, workspaceId, email, secret(), row.codeHash)) {
    await db.workspaceLoginCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } })
    return { ok: false, error: 'invalid' }
  }
  // Single use, even under a double-submit: only the request that flips
  // consumedAt from null proceeds.
  const claimed = await db.workspaceLoginCode.updateMany({
    where: { id: row.id, consumedAt: null },
    data: { consumedAt: new Date() },
  })
  if (claimed.count !== 1) return { ok: false, error: 'invalid' }

  let user = await findUserByEmail(email)
  if (user) {
    const member = await db.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId } },
      select: { role: true },
    })
    if (member) return { ok: true, userId: user.id, role: member.role }
  }

  // Not a member yet — only a pending invite gets them in.
  const invite = await pendingInvite(workspaceId, email)
  if (!invite) return { ok: false, error: 'no_access' }
  if (!user) {
    // onboardingCompletedAt set: an invited teammate never sees the
    // create-a-workspace onboarding meant for new signups.
    user = await db.user.create({ data: { email, emailVerified: new Date(), onboardingCompletedAt: new Date() }, select: { id: true } })
  }
  await db.$transaction([
    db.workspaceMember.create({ data: { userId: user.id, workspaceId, role: invite.role } }),
    db.workspaceInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } }),
  ])
  return { ok: true, userId: user.id, role: invite.role }
}

/** NextAuth database session for `userId`; the caller sets the cookie. */
export async function mintTeamSession(userId: string): Promise<string> {
  const sessionToken = randomBytes(32).toString('hex')
  const expires = new Date(Date.now() + SESSION_MAX_AGE * 1000)
  await db.session.create({ data: { sessionToken, userId, expires } })
  return sessionToken
}
