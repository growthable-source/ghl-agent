import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdminSession, logAdminAction, signAdminToken, setAdminCookie } from '@/lib/admin-auth'
import { verifyCode } from '@/lib/admin-2fa'

export const dynamic = 'force-dynamic'

/**
 * Two flows share this endpoint:
 *
 *  1) Enrolment: admin just scanned the QR. POST { code } with the 6-digit
 *     code from their authenticator. Sets twoFactorVerifiedAt so the next
 *     login requires 2FA.
 *
 *  2) Login second step: admin logged in with password, the login route
 *     issued a half-session cookie (twoFactorVerified=false). POST { code }
 *     here unlocks the full session by reissuing the cookie with
 *     twoFactorVerified=true.
 *
 * Same endpoint because the underlying check is identical — verify the
 * code against the admin's stored secret. The response branches on
 * whether this was enrolment or login.
 */
export async function POST(req: NextRequest) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any = {}
  try { body = await req.json() } catch {}
  const code = String(body?.code ?? '').trim()
  if (!code) return NextResponse.json({ error: 'Code required' }, { status: 400 })

  const admin = await db.superAdmin.findUnique({
    where: { id: session.adminId },
    select: { id: true, email: true, name: true, role: true, twoFactorSecret: true, twoFactorVerifiedAt: true, isActive: true },
  })
  if (!admin || !admin.isActive) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!admin.twoFactorSecret) {
    return NextResponse.json({ error: '2FA not set up. Start from /admin/2fa.' }, { status: 400 })
  }

  const ok = verifyCode(code, admin.twoFactorSecret)
  if (!ok) {
    logAdminAction({ admin: session, action: '2fa_verify_failed' }).catch(() => {})
    return NextResponse.json({ error: 'Invalid code.' }, { status: 401 })
  }

  const wasEnrolment = !admin.twoFactorVerifiedAt
  if (wasEnrolment) {
    await db.superAdmin.update({
      where: { id: admin.id },
      data: { twoFactorVerifiedAt: new Date() },
    })
  }

  // Always reissue the cookie as fully verified.
  const role = (admin.role === 'viewer' || admin.role === 'admin' || admin.role === 'super')
    ? admin.role as 'viewer' | 'admin' | 'super'
    : 'admin'
  const fullSession = {
    adminId: admin.id,
    email: admin.email,
    name: admin.name ?? null,
    role,
    twoFactorVerified: true,
  }
  const token = await signAdminToken(fullSession)
  await setAdminCookie(token)

  logAdminAction({
    admin: fullSession,
    action: wasEnrolment ? '2fa_enrolled' : '2fa_login_verified',
  }).catch(() => {})

  if (wasEnrolment) {
    db.superAdmin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true, enrolled: wasEnrolment })
}
