import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdminSession, logAdminActionAfter } from '@/lib/admin-auth'
import { generateSecret, otpauthQrDataUrl } from '@/lib/admin-2fa'

export const dynamic = 'force-dynamic'

/**
 * GET  → return a fresh TOTP secret + QR data URL for the current admin
 *        to scan. Stores the pending secret on the admin row but does NOT
 *        set twoFactorVerifiedAt — the admin must confirm via /verify.
 * DELETE → disable 2FA for the current admin. Requires a currently-valid
 *        code OR the admin's current password (belt + braces so a hijacked
 *        cookie can't turn 2FA off).
 */

export async function GET() {
  const session = await getAdminSession()
  // Don't require twoFactorVerified here — fresh enrolments start from
  // a no-2FA state, so gating on verified would make the first setup impossible.
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const secret = generateSecret()
  await db.superAdmin.update({
    where: { id: session.adminId },
    // Clear verifiedAt — any previous enrolment is invalidated the moment
    // the admin starts a new one. Prevents the "set, forgot, reset, now
    // there are two valid secrets" footgun.
    data: { twoFactorSecret: secret, twoFactorVerifiedAt: null },
  })

  const qr = await otpauthQrDataUrl(session.email, secret)
  logAdminActionAfter({ admin: session, action: '2fa_setup_started' })
  return NextResponse.json({ secret, qr })
}
