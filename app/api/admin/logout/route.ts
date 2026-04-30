import { NextResponse } from 'next/server'
import { clearAdminCookie, getAdminSession, logAdminActionAfter } from '@/lib/admin-auth'

export async function POST() {
  const session = await getAdminSession()
  if (session) {
    logAdminActionAfter({ admin: session, action: 'logout' })
  }
  await clearAdminCookie()
  return NextResponse.json({ ok: true })
}
