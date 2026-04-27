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
 *
 * Tolerates a pending digest-columns migration: if the columns don't
 * exist yet, GET returns sensible defaults and PATCH 503s with a clear
 * message rather than crashing the dashboard.
 */

function isMissingColumn(err: any): boolean {
  return err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const userId = access.session.user!.id!
  try {
    const member = await db.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: {
        digestOptIn: true,
        lastDigestSentAt: true,
        user: { select: { email: true, name: true } },
      },
    })
    if (!member) return NextResponse.json({ error: 'Not a member' }, { status: 404 })
    return NextResponse.json({
      digestOptIn: member.digestOptIn !== false,
      lastDigestSentAt: member.lastDigestSentAt,
      email: member.user?.email ?? null,
      name: member.user?.name ?? null,
    })
  } catch (err: any) {
    if (isMissingColumn(err)) {
      // Migration pending — return defaults so the dashboard renders.
      const member = await db.workspaceMember.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } },
        select: { user: { select: { email: true, name: true } } },
      }).catch(() => null)
      return NextResponse.json({
        digestOptIn: true,
        lastDigestSentAt: null,
        email: member?.user?.email ?? null,
        name: member?.user?.name ?? null,
        notMigrated: true,
      })
    }
    throw err
  }
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

  try {
    await db.workspaceMember.update({
      where: { id: member.id },
      data: { digestOptIn: body.digestOptIn },
    })
    return NextResponse.json({ ok: true, digestOptIn: body.digestOptIn })
  } catch (err: any) {
    if (isMissingColumn(err)) {
      return NextResponse.json({
        error: "Digest columns aren't migrated yet. Run manual_weekly_digest_email.sql in Supabase.",
        code: 'MIGRATION_PENDING',
      }, { status: 503 })
    }
    throw err
  }
}
