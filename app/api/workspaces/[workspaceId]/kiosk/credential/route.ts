import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'
import { generatePin, hashPin, lastFourOf } from '@/lib/kiosk-auth'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * POST — generate or rotate the shared workspace PIN. Returns the plaintext
 * exactly ONCE; only the bcrypt hash is stored. Rotating invalidates the
 * old PIN immediately and clears any lockout.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceRole(workspaceId, 'admin')
  if (access instanceof NextResponse) return access
  const userId = access.session.user!.id

  const pin = generatePin(6)
  const secretHash = await hashPin(pin)
  const lastFour = lastFourOf(pin)

  await db.kioskCredential.upsert({
    where: { workspaceId },
    create: { workspaceId, secretHash, lastFour, createdBy: userId },
    update: {
      secretHash,
      lastFour,
      disabledAt: null,
      failedAttempts: 0,
      lockedUntil: null,
      rotatedAt: new Date(),
    },
  })

  return NextResponse.json({ ok: true, pin, lastFour })
}

/**
 * DELETE — disable the shared door (soft). Operators can't enter until a
 * new PIN is generated; their identities and history are untouched.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceRole(workspaceId, 'admin')
  if (access instanceof NextResponse) return access

  await db.kioskCredential.updateMany({
    where: { workspaceId },
    data: { disabledAt: new Date() },
  })
  return NextResponse.json({ ok: true })
}
