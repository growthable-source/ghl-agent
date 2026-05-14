import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { can, isValidRole, outranks, assignableRoles, type WorkspaceRole } from '@/lib/permissions'

type Params = { params: Promise<{ workspaceId: string; memberId: string }> }

/**
 * PATCH /api/workspaces/:id/members/:memberId
 * Body: { role: 'admin' | 'member' | 'viewer' }
 *
 * Change a member's role. Subject to two rules:
 *   - You can only assign roles in your assignable set (admins can't
 *     promote anyone to admin)
 *   - You can only change roles of people you outrank (admins can't
 *     demote other admins; nobody but owner can touch an owner)
 *
 * Owners can transfer ownership by promoting another member to
 * 'owner', but the API requires explicit acknowledgement via
 * { transferOwnership: true } to prevent accidental hand-off — that
 * flow is handled in a separate endpoint (TODO) and rejected here
 * to keep this surface predictable.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, memberId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  if (!can(access.role, 'members.role.change')) {
    return NextResponse.json({ error: 'You do not have permission to change member roles.' }, { status: 403 })
  }

  let body: any = {}
  try { body = await req.json() } catch {}
  const requested = body.role
  if (!isValidRole(requested)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }
  if (requested === 'owner') {
    return NextResponse.json({
      error: 'Use the transfer-ownership flow to assign owner.',
    }, { status: 400 })
  }

  const member = await db.workspaceMember.findFirst({
    where: { id: memberId, workspaceId },
    select: { id: true, role: true, userId: true },
  })
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  // Can the actor act on this target? Outranks: actor must be strictly
  // higher than target. Same-rank changes (admin → admin) are rejected.
  if (!outranks(access.role, member.role)) {
    return NextResponse.json({
      error: 'You can only change the role of members below you.',
    }, { status: 403 })
  }
  if (!assignableRoles(access.role as WorkspaceRole).includes(requested as WorkspaceRole)) {
    return NextResponse.json({
      error: 'You cannot assign that role.',
    }, { status: 403 })
  }
  // Refuse to demote yourself out of admin/owner via this endpoint —
  // the only legitimate exit is leave-workspace, which lives elsewhere.
  if (member.userId === access.session.user.id) {
    return NextResponse.json({
      error: "You can't change your own role here. Ask another owner or admin.",
    }, { status: 400 })
  }

  await db.workspaceMember.update({
    where: { id: memberId },
    data: { role: requested },
  })
  return NextResponse.json({ ok: true })
}

/**
 * DELETE /api/workspaces/:id/members/:memberId
 *
 * Remove a member from the workspace. Same outranking rule as PATCH:
 * admins can remove members + viewers; owners can remove anyone
 * except the last remaining owner. Self-removal is allowed (people
 * leaving a workspace they were invited to) — but only if they're
 * not the last owner.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, memberId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const member = await db.workspaceMember.findFirst({
    where: { id: memberId, workspaceId },
    select: { id: true, role: true, userId: true },
  })
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const isSelf = member.userId === access.session.user.id

  if (!isSelf && !can(access.role, 'members.remove')) {
    return NextResponse.json({ error: 'You do not have permission to remove members.' }, { status: 403 })
  }
  if (!isSelf && !outranks(access.role, member.role)) {
    return NextResponse.json({
      error: 'You can only remove members below you.',
    }, { status: 403 })
  }

  // Don't allow the last owner to leave — would orphan the workspace.
  if (member.role === 'owner') {
    const ownerCount = await db.workspaceMember.count({
      where: { workspaceId, role: 'owner' },
    })
    if (ownerCount <= 1) {
      return NextResponse.json({
        error: "Can't remove the last owner. Transfer ownership first.",
      }, { status: 400 })
    }
  }

  await db.workspaceMember.delete({ where: { id: memberId } })
  return NextResponse.json({ ok: true })
}
