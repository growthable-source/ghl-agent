import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { REGULAR_SESSION_COOKIE } from '@/lib/embed-session'
import {
  verifyPin,
  nextLockState,
  verifyKioskLauncher,
  mintOperatorSession,
  KIOSK_LAUNCHER_COOKIE,
} from '@/lib/kiosk-auth'

type Params = { params: Promise<{ slug: string }> }

const SESSION_MAX_AGE = 60 * 60 * 24 * 90 // 90 days — matches lib/auth.ts

// Roles a shared credential may ever resolve to. A kiosk operator is
// provisioned as 'agent'; 'member' is tolerated. Owner/admin/viewer are
// hard-refused so the shared door can never escalate privilege even if an
// operator's underlying member role was changed by hand.
const KIOSK_SAFE_ROLES = new Set(['agent', 'member'])

/**
 * POST /api/kiosk/<slug>/select
 * Body: { operatorId: string, pin: string }
 *
 * Validates the launcher cookie (shared PIN was entered for THIS workspace),
 * the operator's secondary PIN, and a hard role gate, then mints a normal
 * NextAuth session as that operator's real User.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params

  const launcherWorkspaceId = await verifyKioskLauncher(
    req.cookies.get(KIOSK_LAUNCHER_COOKIE)?.value,
  )
  if (!launcherWorkspaceId) {
    return NextResponse.json({ error: 'Enter the workspace PIN first.', code: 'LAUNCHER_REQUIRED' }, { status: 401 })
  }

  let body: any = {}
  try { body = await req.json() } catch {}
  const operatorId = typeof body?.operatorId === 'string' ? body.operatorId : ''
  const pin = typeof body?.pin === 'string' ? body.pin.trim() : ''
  if (!operatorId || !pin) {
    return NextResponse.json({ error: 'operatorId and pin required' }, { status: 400 })
  }

  // Resolve the workspace from the slug and confirm the launcher was minted
  // for the SAME workspace — defence against a launcher cookie from another.
  const workspace = await db.workspace.findUnique({ where: { slug }, select: { id: true } })
  if (!workspace || workspace.id !== launcherWorkspaceId) {
    return NextResponse.json({ error: 'Kiosk not available' }, { status: 404 })
  }

  const operator = await db.kioskOperator.findFirst({
    where: { id: operatorId, workspaceId: workspace.id, disabledAt: null },
  })
  if (!operator) {
    return NextResponse.json({ error: 'Operator not found' }, { status: 404 })
  }

  const now = new Date()
  if (operator.lockedUntil && operator.lockedUntil > now) {
    return NextResponse.json({ error: 'Too many attempts. Try again shortly.' }, { status: 429 })
  }

  const ok = await verifyPin(pin, operator.pinHash)
  const { next } = nextLockState(
    { failedAttempts: operator.failedAttempts, lockedUntil: operator.lockedUntil },
    now,
    ok,
  )
  await db.kioskOperator.update({
    where: { id: operator.id },
    data: { failedAttempts: next.failedAttempts, lockedUntil: next.lockedUntil },
  })

  if (!ok) {
    const lockedNow = !!(next.lockedUntil && next.lockedUntil > now)
    return NextResponse.json(
      { error: lockedNow ? 'Too many attempts. Try again shortly.' : 'Incorrect PIN' },
      { status: lockedNow ? 429 : 401 },
    )
  }

  // Hard role gate (defence in depth) — never mint a session for a member
  // whose role can see settings/billing/etc.
  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: operator.userId, workspaceId: workspace.id } },
    select: { role: true },
  })
  if (!member || !KIOSK_SAFE_ROLES.has(member.role)) {
    return NextResponse.json({ error: 'This operator can no longer sign in via the kiosk.' }, { status: 403 })
  }

  const sessionToken = await mintOperatorSession(operator.userId)
  const res = NextResponse.json({
    ok: true,
    redirectTo: `/dashboard/${workspace.id}/inbox`,
  })
  res.cookies.set({
    name: REGULAR_SESSION_COOKIE,
    value: sessionToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  })
  return res
}
