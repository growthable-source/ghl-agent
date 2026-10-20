import { NextResponse } from 'next/server'
import { getAdminSession, logAdminActionAfter } from '@/lib/admin-auth'
import { clearSupportCookie, readSupportCookie } from '@/lib/support-session'

export const dynamic = 'force-dynamic'

/**
 * POST — end the current support session (the "Exit support mode" button
 * in the dashboard banner). Always clears the cookie; logs the end when
 * the admin session that started it is still around.
 */
export async function POST() {
  const claim = await readSupportCookie()
  const admin = await getAdminSession()
  await clearSupportCookie()
  if (claim && admin && admin.adminId === claim.adminId) {
    logAdminActionAfter({ admin, action: 'support_session_end', target: claim.workspaceId })
  }
  return NextResponse.json({ ok: true })
}
