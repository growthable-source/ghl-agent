import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/<id>/kiosk — admin view of the shared-login setup:
 * whether the shared PIN is configured, the slug operators land on, and
 * the roster of operator identities. Never returns PIN material.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceRole(workspaceId, 'admin')
  if (access instanceof NextResponse) return access

  try {
    const [workspace, cred, operators] = await Promise.all([
      db.workspace.findUnique({ where: { id: workspaceId }, select: { slug: true } }),
      db.kioskCredential.findUnique({ where: { workspaceId } }),
      db.kioskOperator.findMany({
        where: { workspaceId },
        select: {
          id: true,
          displayName: true,
          disabledAt: true,
          lockedUntil: true,
          createdAt: true,
          user: { select: { workspaces: { where: { workspaceId }, select: { isAvailable: true } } } },
        },
        orderBy: { displayName: 'asc' },
      }),
    ])

    return NextResponse.json({
      slug: workspace?.slug ?? null,
      credential: cred
        ? { configured: true, lastFour: cred.lastFour, disabled: !!cred.disabledAt }
        : { configured: false },
      operators: operators.map(o => ({
        id: o.id,
        displayName: o.displayName,
        disabled: !!o.disabledAt,
        locked: !!(o.lockedUntil && o.lockedUntil > new Date()),
        available: o.user?.workspaces?.[0]?.isAvailable ?? null,
        createdAt: o.createdAt.toISOString(),
      })),
    })
  } catch (err: any) {
    if (err?.code === 'P2021' || err?.code === 'P2022' || /does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({
        migrationPending: true,
        slug: null,
        credential: { configured: false },
        operators: [],
      })
    }
    throw err
  }
}
