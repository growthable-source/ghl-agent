import { NextResponse } from 'next/server'
import { clearAdminCookie, getAdminSession, logAdminAction } from '@/lib/admin-auth'

export async function POST() {
  const session = await getAdminSession()
  if (session) {
    logAdminAction({ admin: session, action: 'logout' }).catch(() => {})
  }
  await clearAdminCookie()
  return NextResponse.json({ ok: true })
}
