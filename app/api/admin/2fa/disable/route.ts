import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdminSession, logAdminActionAfter, verifyPassword } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

/**
 * Disable 2FA for the current admin. Requires the admin's password as a
 * last-line-of-defence so a stolen cookie can't silently turn 2FA off.
 */
export async function POST(req: NextRequest) {
  const session = await getAdminSession()
  if (!session || !session.twoFactorVerified) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: any = {}
  try { body = await req.json() } catch {}
  const password = String(body?.password ?? '')
  if (!password) return NextResponse.json({ error: 'Password required' }, { status: 400 })

  const admin = await db.superAdmin.findUnique({
    where: { id: session.adminId },
    select: { passwordHash: true },
  })
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const ok = await verifyPassword(password, admin.passwordHash)
  if (!ok) {
    logAdminActionAfter({ admin: session, action: '2fa_disable_bad_password' })
    return NextResponse.json({ error: 'Invalid password.' }, { status: 401 })
  }

  await db.superAdmin.update({
    where: { id: session.adminId },
    data: { twoFactorSecret: null, twoFactorVerifiedAt: null },
  })
  logAdminActionAfter({ admin: session, action: '2fa_disabled' })
  return NextResponse.json({ ok: true })
}
