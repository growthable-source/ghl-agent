import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  verifyPin,
  nextLockState,
  signKioskLauncher,
  KIOSK_LAUNCHER_COOKIE,
  LAUNCHER_COOKIE_MAX_AGE,
} from '@/lib/kiosk-auth'

type Params = { params: Promise<{ slug: string }> }

/**
 * POST /api/kiosk/<slug>/enter
 * Body: { pin: string }  — the shared workspace PIN.
 *
 * On success: sets the short-lived launcher cookie and returns the list of
 * selectable operators (names only — no PIN material). The launcher cookie
 * grants NO app access; it only unlocks the picker.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params

  let body: any = {}
  try { body = await req.json() } catch {}
  const pin = typeof body?.pin === 'string' ? body.pin.trim() : ''
  if (!pin) {
    return NextResponse.json({ error: 'PIN required' }, { status: 400 })
  }

  const workspace = await db.workspace.findUnique({
    where: { slug },
    select: { id: true },
  })
  // Generic 404 — don't leak whether a slug exists.
  if (!workspace) {
    return NextResponse.json({ error: 'Kiosk not available' }, { status: 404 })
  }

  let cred: any = null
  try {
    cred = await db.kioskCredential.findUnique({ where: { workspaceId: workspace.id } })
  } catch (err: any) {
    if (err?.code === 'P2021' || err?.code === 'P2022' || /does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ error: 'Kiosk not available' }, { status: 404 })
    }
    throw err
  }
  if (!cred || cred.disabledAt) {
    return NextResponse.json({ error: 'Kiosk not available' }, { status: 404 })
  }

  const now = new Date()
  // Hard stop if currently locked out.
  if (cred.lockedUntil && cred.lockedUntil > now) {
    return NextResponse.json({ error: 'Too many attempts. Try again shortly.' }, { status: 429 })
  }

  const ok = await verifyPin(pin, cred.secretHash)
  const { next } = nextLockState(
    { failedAttempts: cred.failedAttempts, lockedUntil: cred.lockedUntil },
    now,
    ok,
  )
  await db.kioskCredential.update({
    where: { id: cred.id },
    data: { failedAttempts: next.failedAttempts, lockedUntil: next.lockedUntil },
  })

  if (!ok) {
    const lockedNow = !!(next.lockedUntil && next.lockedUntil > now)
    return NextResponse.json(
      { error: lockedNow ? 'Too many attempts. Try again shortly.' : 'Incorrect PIN' },
      { status: lockedNow ? 429 : 401 },
    )
  }

  const operators = await db.kioskOperator.findMany({
    where: { workspaceId: workspace.id, disabledAt: null },
    select: { id: true, displayName: true },
    orderBy: { displayName: 'asc' },
  })

  const token = await signKioskLauncher(workspace.id)
  const res = NextResponse.json({ ok: true, operators })
  res.cookies.set({
    name: KIOSK_LAUNCHER_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: LAUNCHER_COOKIE_MAX_AGE,
  })
  return res
}
