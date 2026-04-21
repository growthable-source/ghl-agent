import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminAction, hashPassword } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

// PATCH — update role / active state / reset password. Super only.
// Guardrails: you can't demote yourself out of super (would lock you out),
// you can't deactivate yourself (same), and you can't remove the last
// super admin.
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await requireAdminRole('super')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  let body: any = {}
  try { body = await req.json() } catch {}

  const target = await db.superAdmin.findUnique({ where: { id } })
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const data: any = {}

  if (body.role !== undefined) {
    if (!['viewer', 'admin', 'super'].includes(body.role)) {
      return NextResponse.json({ error: 'Role must be viewer / admin / super' }, { status: 400 })
    }
    if (target.id === session.adminId && body.role !== 'super') {
      return NextResponse.json({
        error: 'You cannot demote yourself from super. Ask another super admin to do it.',
      }, { status: 400 })
    }
    // If target is currently super and we're about to demote them, make
    // sure at least one other super remains.
    if (target.role === 'super' && body.role !== 'super') {
      const otherSupers = await db.superAdmin.count({
        where: { role: 'super', isActive: true, id: { not: target.id } },
      })
      if (otherSupers === 0) {
        return NextResponse.json({
          error: 'Cannot demote the last super admin.',
        }, { status: 400 })
      }
    }
    data.role = body.role
  }

  if (body.isActive !== undefined) {
    if (target.id === session.adminId && !body.isActive) {
      return NextResponse.json({
        error: 'You cannot deactivate yourself.',
      }, { status: 400 })
    }
    if (target.role === 'super' && !body.isActive) {
      const otherSupers = await db.superAdmin.count({
        where: { role: 'super', isActive: true, id: { not: target.id } },
      })
      if (otherSupers === 0) {
        return NextResponse.json({
          error: 'Cannot deactivate the last super admin.',
        }, { status: 400 })
      }
    }
    data.isActive = !!body.isActive
  }

  if (body.name !== undefined) data.name = body.name ? String(body.name).trim() : null

  if (body.password !== undefined) {
    const pw = String(body.password)
    if (pw.length < 10) {
      return NextResponse.json({ error: 'Password must be at least 10 characters' }, { status: 400 })
    }
    data.passwordHash = await hashPassword(pw)
    // Reset 2FA on a password reset — if someone else is resetting your
    // password, the stored TOTP secret is a vector the old owner could
    // still use. Force re-enrol.
    data.twoFactorSecret = null
    data.twoFactorVerifiedAt = null
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const updated = await db.superAdmin.update({
    where: { id },
    data,
    select: {
      id: true, email: true, name: true, role: true, isActive: true,
      lastLoginAt: true, createdAt: true, twoFactorVerifiedAt: true,
    },
  })
  logAdminAction({
    admin: session,
    action: 'update_admin',
    target: id,
    meta: { changes: Object.keys(data) },
  }).catch(() => {})
  return NextResponse.json({ admin: updated })
}

// DELETE — hard delete. Same guardrails as deactivate, plus you can't
// delete yourself. Prefer deactivate; delete only when clearing out a
// never-used account.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await requireAdminRole('super')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await params

  if (id === session.adminId) {
    return NextResponse.json({ error: 'You cannot delete yourself.' }, { status: 400 })
  }
  const target = await db.superAdmin.findUnique({ where: { id } })
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (target.role === 'super') {
    const otherSupers = await db.superAdmin.count({
      where: { role: 'super', isActive: true, id: { not: target.id } },
    })
    if (otherSupers === 0) {
      return NextResponse.json({ error: 'Cannot delete the last super admin.' }, { status: 400 })
    }
  }
  await db.superAdmin.delete({ where: { id } })
  logAdminAction({
    admin: session,
    action: 'delete_admin',
    target: id,
    meta: { email: target.email },
  }).catch(() => {})
  return NextResponse.json({ ok: true })
}
