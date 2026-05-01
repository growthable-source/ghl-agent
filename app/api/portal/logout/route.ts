import { NextRequest, NextResponse } from 'next/server'
import { clearPortalCookie } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

// POST /api/portal/logout — clear the portal cookie and bounce back to
// /portal/login. 303 forces the browser to re-fetch with GET so the
// form submission doesn't get re-POSTed on back/forward navigation.
export async function POST(req: NextRequest) {
  await clearPortalCookie()
  return NextResponse.redirect(new URL('/portal/login', req.url), 303)
}
