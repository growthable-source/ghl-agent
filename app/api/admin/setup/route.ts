import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, signAdminToken, setAdminCookie, logAdminAction } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

/**
 * One-time web bootstrap for the FIRST super admin.
 *
 * GET  → returns { ready, requiresToken, alreadyConfigured } so the UI
 *        can render the right state without a second round-trip.
 * POST → creates the admin iff zero admins currently exist and (if
 *        ADMIN_BOOTSTRAP_SECRET is set) the caller-supplied token matches.
 *        On success, signs the new admin in immediately and returns ok.
 *
 * There is NO way to re-open this endpoint once configured short of
 * deleting every SuperAdmin row manually. That's deliberate — a
 * configurable "reset" is an attack vector, the CLI or manual DB
 * surgery is the right way to recover from a lockout.
 */

function requiresToken(): boolean {
  return !!process.env.ADMIN_BOOTSTRAP_SECRET
}

async function isAlreadyConfigured(): Promise<boolean> {
  try {
    const count = await db.superAdmin.count()
    return count > 0
  } catch (err: any) {
    // If the SuperAdmin table doesn't exist yet (migration not run), the
    // safest answer is "not configured" so the setup form still appears.
    // The POST will fail with a clear error telling them to run the
    // migration.
    if (err.code === 'P2021') return false
    throw err
  }
}

export async function GET() {
  try {
    const alreadyConfigured = await isAlreadyConfigured()
    return NextResponse.json({
      ready: !alreadyConfigured,
      requiresToken: requiresToken(),
      alreadyConfigured,
      error: null,
    })
  } catch (err: any) {
    return NextResponse.json({
      ready: false,
      requiresToken: false,
      alreadyConfigured: false,
      error: `Server error: ${err.message}`,
    }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  let body: any = {}
  try { body = await req.json() } catch {}

  const email = String(body?.email ?? '').trim().toLowerCase()
  const name = body?.name ? String(body.name).trim() : null
  const password = String(body?.password ?? '')
  const token = body?.token ? String(body.token) : ''

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required.' }, { status: 400 })
  }
  if (password.length < 10) {
    return NextResponse.json({ error: 'Password must be at least 10 characters.' }, { status: 400 })
  }

  // Refuse if any admin already exists. This is THE guard — without it the
  // endpoint would be a perpetual backdoor.
  let alreadyConfigured: boolean
  try {
    alreadyConfigured = await isAlreadyConfigured()
  } catch (err: any) {
    return NextResponse.json({
      error: `Database not ready: ${err.message}. Did you run the migration at prisma/migrations/manual_admin_backend.sql?`,
    }, { status: 500 })
  }
  if (alreadyConfigured) {
    return NextResponse.json({
      error: 'A super admin already exists. Setup is locked. Use /admin/login or the create-admin CLI to reset a password.',
    }, { status: 409 })
  }

  // Bootstrap-token gate (optional). If the env var is set, the caller
  // MUST match it. Uses a length-first check so an empty-token caller
  // doesn't get a timing signal on the env value length.
  const expectedToken = process.env.ADMIN_BOOTSTRAP_SECRET
  if (expectedToken && token !== expectedToken) {
    return NextResponse.json({
      error: 'Bootstrap token missing or incorrect.',
    }, { status: 401 })
  }

  try {
    const hash = await hashPassword(password)
    const admin = await db.superAdmin.create({
      // First-setup admin is always super so there's at least one account
      // that can create more admins and change system settings.
      data: { email, name, passwordHash: hash, isActive: true, role: 'super' },
    })

    // Sign the new admin in immediately so they land on /admin on the
    // next navigation. No separate login step — they just typed the
    // password anyway. twoFactorVerified=true because first-setup hasn't
    // enrolled 2FA yet (they can turn it on from /admin/2fa later).
    const session = {
      adminId: admin.id,
      email: admin.email,
      name: admin.name ?? null,
      role: 'super' as const,
      twoFactorVerified: true,
    }
    const jwt = await signAdminToken(session)
    await setAdminCookie(jwt)
    await db.superAdmin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    }).catch(() => {})

    logAdminAction({
      admin: session,
      action: 'bootstrap_first_admin',
      meta: { viaWebSetup: true },
    }).catch(() => {})

    return NextResponse.json({ ok: true, admin: { email: admin.email, name: admin.name } })
  } catch (err: any) {
    // Unique constraint — there's a race window where two setup submissions
    // arrive at the same time. Return the same locked error so the loser
    // gets a sane message.
    if (err.code === 'P2002') {
      return NextResponse.json({
        error: 'A super admin was just created. Go to /admin/login.',
      }, { status: 409 })
    }
    console.error('[AdminSetup] create failed:', err)
    return NextResponse.json({ error: err.message || 'Setup failed.' }, { status: 500 })
  }
}
