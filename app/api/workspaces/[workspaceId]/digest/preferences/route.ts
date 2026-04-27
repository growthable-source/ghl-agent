import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /preferences  → { digestOptIn, email, lastDigestSentAt }
 * PATCH /preferences body { digestOptIn: boolean }
 *
 * Per-user, per-workspace digest opt-in. Toggling here updates the
 * caller's WorkspaceMember row only — never anyone else's.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const userId = access.session.user!.id!
  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    include: { user: { select: { email: true, name: true } } },
  })
  if (!member) return NextResponse.json({ error: 'Not a member' }, { status: 404 })

  return NextResponse.json({
    digestOptIn: (member as any).digestOptIn !== false,
    lastDigestSentAt: (member as any).lastDigestSentAt ?? null,
    email: member.user?.email ?? null,
    name: member.user?.name ?? null,
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const userId = access.session.user!.id!

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (typeof body.digestOptIn !== 'boolean') {
    return NextResponse.json({ error: 'digestOptIn must be boolean' }, { status: 400 })
  }

  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { id: true },
  })
  if (!member) return NextResponse.json({ error: 'Not a member' }, { status: 404 })

  await db.workspaceMember.update({
    where: { id: member.id },
    data: { digestOptIn: body.digestOptIn } as any,
  })
  return NextResponse.json({ ok: true, digestOptIn: body.digestOptIn })
}
