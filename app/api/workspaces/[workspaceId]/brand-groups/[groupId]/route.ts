import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; groupId: string }> }

/**
 * PATCH /api/workspaces/:id/brand-groups/:groupId
 * Body: { name?, description?, priority?, color?, brandIds? }
 *
 * brandIds: full replacement list of brand ids that belong to this
 * group (sync). Brands omitted from the list get detached. Brands not
 * already in this workspace are silently dropped.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, groupId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const group = await (db as any).brandGroup.findFirst({
    where: { id: groupId, workspaceId },
    select: { id: true },
  })
  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 })

  let body: any = {}
  try { body = await req.json() } catch {}

  const data: any = {}
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 80)
  if (body.description !== undefined) {
    data.description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null
  }
  if (body.priority !== undefined && Number.isFinite(body.priority)) {
    data.priority = Math.max(0, Math.min(9999, Math.round(body.priority)))
  }
  if (body.color !== undefined) {
    data.color = typeof body.color === 'string' && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : null
  }

  if (Object.keys(data).length > 0) {
    try {
      await (db as any).brandGroup.update({ where: { id: groupId }, data })
    } catch (err: any) {
      if (err?.code === 'P2002') {
        return NextResponse.json({ error: 'A group with that name already exists.' }, { status: 409 })
      }
      throw err
    }
  }

  // Optional brand-membership sync. Two-phase: detach anything no
  // longer in the list, attach anything new. Brands belonging to other
  // workspaces are silently filtered so a hostile body can't reach
  // across tenants.
  if (Array.isArray(body.brandIds)) {
    const wantIds = body.brandIds.filter((id: unknown): id is string => typeof id === 'string')
    const valid = await db.brand.findMany({
      where: { id: { in: wantIds }, workspaceId },
      select: { id: true },
    })
    const validIds = new Set(valid.map((b: any) => b.id))
    await db.$transaction([
      // Detach anything that was in this group but isn't in the new list.
      db.brand.updateMany({
        where: { workspaceId, brandGroupId: groupId, id: { notIn: Array.from(validIds) } },
        data: { brandGroupId: null },
      } as any),
      // Attach new members (idempotent — already-attached brands no-op).
      db.brand.updateMany({
        where: { workspaceId, id: { in: Array.from(validIds) } },
        data: { brandGroupId: groupId },
      } as any),
    ])
  }

  return NextResponse.json({ ok: true })
}

/**
 * DELETE /api/workspaces/:id/brand-groups/:groupId
 *
 * Removes the group. Brands tagged to it become ungrouped (Brand.brandGroupId
 * is SetNull on FK delete) — they're not deleted, just demoted to the
 * lowest priority tier.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, groupId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const group = await (db as any).brandGroup.findFirst({
    where: { id: groupId, workspaceId },
    select: { id: true },
  })
  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 })

  await (db as any).brandGroup.delete({ where: { id: groupId } })
  return NextResponse.json({ ok: true })
}
