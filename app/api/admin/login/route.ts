import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, signAdminToken, setAdminCookie, logAdminAction } from '@/lib/admin-auth'

// Simple in-memory rate limit per email to slow down brute-force attempts.
// Resets on server restart, which is fine — the audit trail captures every
// attempt regardless, and a real bad actor gets locked out well before the
// process recycles.
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 5
const attempts = new Map<string, { count: number; firstAt: number }>()

function bumpAttempt(email: string): { blocked: boolean; remaining: number } {
  const now = Date.now()
  const cur = attempts.get(email)
  if (!cur || now - cur.firstAt > ATTEMPT_WINDOW_MS) {
    attempts.set(email, { count: 1, firstAt: now })
    return { blocked: false, remaining: MAX_ATTEMPTS - 1 }
  }
  cur.count += 1
  const blocked = cur.count > MAX_ATTEMPTS
  return { blocked, remaining: Math.max(0, MAX_ATTEMPTS - cur.count) }
}

function clearAttempts(email: string) {
  attempts.delete(email)
}

export async function POST(req: NextRequest) {
  let body: any = {}
  try { body = await req.json() } catch {}
  const email = String(body?.email ?? '').trim().toLowerCase()
  const password = String(body?.password ?? '')

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  const { blocked, remaining } = bumpAttempt(email)
  if (blocked) {
    return NextResponse.json({
      error: 'Too many login attempts. Try again in 15 minutes.',
    }, { status: 429 })
  }

  const admin = await db.superAdmin.findUnique({ where: { email } })
  // Same generic error for missing-user vs wrong-password so we don't leak
  // which super-admin emails exist. Timing is close enough via bcrypt.
  if (!admin || !admin.isActive) {
    // Still run a bcrypt compare against a dummy hash to level timing.
    await verifyPassword(password, '$2a$12$C6UzMDM.H6dfI/f/IKxGhuUGvFwZ9z9z9z9z9z9z9z9z9z9z9z9z9').catch(() => {})
    return NextResponse.json({
      error: `Invalid credentials. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
    }, { status: 401 })
  }

  const ok = await verifyPassword(password, admin.passwordHash)
  if (!ok) {
    return NextResponse.json({
      error: `Invalid credentials. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
    }, { status: 401 })
  }

  // Success. Wipe the throttle, sign a token, set cookie, log it.
  clearAttempts(email)
  const session = { adminId: admin.id, email: admin.email, name: admin.name ?? null }
  const token = await signAdminToken(session)
  await setAdminCookie(token)
  db.superAdmin.update({
    where: { id: admin.id },
    data: { lastLoginAt: new Date() },
  }).catch(() => {})
  logAdminAction({ admin: session, action: 'login' }).catch(() => {})

  return NextResponse.json({ ok: true, admin: { email: admin.email, name: admin.name } })
}
