import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { REGULAR_SESSION_COOKIE } from '@/lib/embed-session'

/**
 * POST /api/kiosk/end — sign the current kiosk operator out.
 *
 * Deletes the backing Session row and clears the cookie so an operator
 * leaving the shared terminal doesn't leave their identity live. The
 * client then bounces back to the kiosk picker.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get(REGULAR_SESSION_COOKIE)?.value
    ?? req.cookies.get('authjs.session-token')?.value
  if (token) {
    await db.session.deleteMany({ where: { sessionToken: token } }).catch(() => {})
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(REGULAR_SESSION_COOKIE)
  res.cookies.delete('authjs.session-token')
  return res
}
