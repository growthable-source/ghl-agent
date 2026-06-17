import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'
import { generatePin, hashPin, syntheticOperatorEmail } from '@/lib/kiosk-auth'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * POST — add a kiosk operator identity.
 * Body: { displayName: string }
 *
 * Provisions a synthetic User (non-deliverable email, no OAuth account,
 * onboarding pre-completed) + a WorkspaceMember(role 'agent') + the
 * KioskOperator row. Because the identity is a real member, presence,
 * routing, and attribution all work with zero special-casing. Returns the
 * operator's 4-digit PIN exactly once.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceRole(workspaceId, 'admin')
  if (access instanceof NextResponse) return access
  const createdBy = access.session.user!.id

  let body: any = {}
  try { body = await req.json() } catch {}
  const displayName = typeof body?.displayName === 'string' ? body.displayName.trim() : ''
  if (!displayName) {
    return NextResponse.json({ error: 'displayName required' }, { status: 400 })
  }

  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { slug: true } })
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  const pin = generatePin(4)
  const pinHash = await hashPin(pin)
  const email = syntheticOperatorEmail(workspace.slug)
  const now = new Date()

  const operator = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        name: displayName,
        // Strong-enough identity signal (admin provisioned) + skips the
        // onboarding modal gate in app/dashboard/layout.tsx.
        emailVerified: now,
        onboardingCompletedAt: now,
      },
      select: { id: true },
    })
    await tx.workspaceMember.create({
      data: { userId: user.id, workspaceId, role: 'agent' },
    })
    return tx.kioskOperator.create({
      data: { workspaceId, userId: user.id, displayName, pinHash, createdBy },
      select: { id: true, displayName: true },
    })
  })

  return NextResponse.json({ ok: true, operator, pin })
}
