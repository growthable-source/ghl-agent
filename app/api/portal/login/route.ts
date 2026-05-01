import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  signPortalToken,
  setPortalCookie,
  verifyPortalPassword,
} from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

// POST /api/portal/login — email + password, returns nothing on success
// (cookie is the proof). Generic error message on failure to avoid the
// "user enumeration via different errors" hole.
export async function POST(req: NextRequest) {
  let body: any = {}
  try { body = await req.json() } catch {}
  const email = String(body?.email ?? '').trim().toLowerCase()
  const password = String(body?.password ?? '')

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  // Pull every PortalUser with this email — same email may exist across
  // multiple portals (different agencies inviting the same end customer),
  // and we let the password resolve which portal they're logging into.
  const candidates = await db.portalUser.findMany({
    where: { email, isActive: true, passwordHash: { not: null } },
    select: { id: true, portalId: true, email: true, passwordHash: true, portal: { select: { isActive: true } } },
    take: 5,
  })

  for (const u of candidates) {
    if (!u.portal.isActive || !u.passwordHash) continue
    const ok = await verifyPortalPassword(password, u.passwordHash)
    if (!ok) continue
    const token = await signPortalToken({ userId: u.id, portalId: u.portalId, email: u.email })
    await setPortalCookie(token)
    await db.portalUser.update({
      where: { id: u.id },
      data: { lastLoginAt: new Date() },
    })
    return NextResponse.json({ ok: true })
  }

  // Constant-ish failure path — don't leak whether email exists.
  return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
}
