import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, signAdminToken, setAdminCookie, logAdminAction, type AdminRole } from '@/lib/admin-auth'

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
  if (!admin || !admin.isActive) {
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

  clearAttempts(email)

  // Password check passed. If 2FA is enrolled + verified, issue a
  // "half-session" cookie (twoFactorVerified=false) and tell the client
  // to prompt for the TOTP code. Otherwise issue the full-access cookie.
  const role = (admin.role === 'viewer' || admin.role === 'admin' || admin.role === 'super')
    ? admin.role as AdminRole
    : 'admin'
  const requires2fa = !!admin.twoFactorVerifiedAt

  const session = {
    adminId: admin.id,
    email: admin.email,
    name: admin.name ?? null,
    role,
    twoFactorVerified: !requires2fa,  // true when no 2FA is enrolled yet
  }
  const token = await signAdminToken(session)
  await setAdminCookie(token)

  if (!requires2fa) {
    db.superAdmin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    }).catch(() => {})
    logAdminAction({ admin: session, action: 'login' }).catch(() => {})
  } else {
    logAdminAction({ admin: session, action: 'login_password_ok_awaiting_2fa' }).catch(() => {})
  }

  return NextResponse.json({
    ok: true,
    requires2fa,
    admin: { email: admin.email, name: admin.name, role },
  })
}
