import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter, hashPassword } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

// GET — list all super-admins. Viewer can't see this (it's super-gated),
// admin can see, super can see + mutate.
export async function GET() {
  const session = await requireAdminRole('super')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const admins = await db.superAdmin.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, email: true, name: true, role: true, isActive: true,
      lastLoginAt: true, createdAt: true, twoFactorVerifiedAt: true,
    },
  })
  return NextResponse.json({ admins })
}

// POST — create a new admin. Super only.
export async function POST(req: NextRequest) {
  const session = await requireAdminRole('super')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any = {}
  try { body = await req.json() } catch {}
  const email = String(body?.email ?? '').trim().toLowerCase()
  const name = body?.name ? String(body.name).trim() : null
  const password = String(body?.password ?? '')
  const role = body?.role
  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }
  if (password.length < 10) {
    return NextResponse.json({ error: 'Password must be at least 10 characters' }, { status: 400 })
  }
  if (!['viewer', 'admin', 'super'].includes(role)) {
    return NextResponse.json({ error: 'Role must be viewer / admin / super' }, { status: 400 })
  }

  try {
    const hash = await hashPassword(password)
    const admin = await db.superAdmin.create({
      data: { email, name, passwordHash: hash, role, isActive: true },
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    })
    logAdminActionAfter({
      admin: session,
      action: 'create_admin',
      target: admin.id,
      meta: { email, role },
    })
    return NextResponse.json({ admin }, { status: 201 })
  } catch (err: any) {
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'An admin with that email already exists.' }, { status: 409 })
    }
    console.error('[Admin] create failed:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
