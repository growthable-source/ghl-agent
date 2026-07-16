import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'
import { generatePin, hashPin } from '@/lib/kiosk-auth'

type Params = { params: Promise<{ workspaceId: string; operatorId: string }> }

async function loadOperator(workspaceId: string, operatorId: string) {
  return db.kioskOperator.findFirst({
    where: { id: operatorId, workspaceId },
    select: { id: true, userId: true },
  })
}

/**
 * PATCH — manage one operator.
 * Body: { displayName?: string, action?: 'reset_pin' | 'disable' | 'enable' }
 * `reset_pin` returns the new 4-digit PIN once. `disable` also marks the
 * underlying member unavailable so routing stops sending them chats.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, operatorId } = await params
  const access = await requireWorkspaceRole(workspaceId, 'admin')
  if (access instanceof NextResponse) return access

  const operator = await loadOperator(workspaceId, operatorId)
  if (!operator) return NextResponse.json({ error: 'Operator not found' }, { status: 404 })

  let body: any = {}
  try { body = await req.json() } catch {}

  const data: any = {}
  let newPin: string | null = null

  if (typeof body?.displayName === 'string' && body.displayName.trim()) {
    const displayName = body.displayName.trim()
    data.displayName = displayName
    // Keep the synthetic User's name in sync so the inbox/assignee UI,
    // which reads User.name, shows the operator's chosen name.
    await db.user.update({ where: { id: operator.userId }, data: { name: displayName } })
  }

  if (body?.action === 'reset_pin') {
    newPin = generatePin(4)
    data.pinHash = await hashPin(newPin)
    data.failedAttempts = 0
    data.lockedUntil = null
  } else if (body?.action === 'disable') {
    data.disabledAt = new Date()
    // presenceSource 'kiosk' so a stray dashboard heartbeat can never
    // auto-restore a deliberately disabled operator (only 'system' flips
    // are heartbeat-reversible). Column may predate the auto-away
    // migration — retry without it.
    try {
      await db.workspaceMember.updateMany({
        where: { userId: operator.userId, workspaceId },
        data: { isAvailable: false, availabilityChangedAt: new Date(), presenceSource: 'kiosk' } as any,
      })
    } catch {
      await db.workspaceMember.updateMany({
        where: { userId: operator.userId, workspaceId },
        data: { isAvailable: false, availabilityChangedAt: new Date() },
      })
    }
  } else if (body?.action === 'enable') {
    data.disabledAt = null
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  await db.kioskOperator.update({ where: { id: operator.id }, data })
  return NextResponse.json({ ok: true, ...(newPin ? { pin: newPin } : {}) })
}

/**
 * DELETE — remove an operator. Drops the KioskOperator + the WorkspaceMember
 * so they vanish from routing and the kiosk, but KEEPS the synthetic User so
 * past message attribution (sentByUserId) stays intact.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, operatorId } = await params
  const access = await requireWorkspaceRole(workspaceId, 'admin')
  if (access instanceof NextResponse) return access

  const operator = await loadOperator(workspaceId, operatorId)
  if (!operator) return NextResponse.json({ error: 'Operator not found' }, { status: 404 })

  await db.$transaction(async (tx) => {
    await tx.kioskOperator.delete({ where: { id: operator.id } })
    await tx.workspaceMember.deleteMany({ where: { userId: operator.userId, workspaceId } })
  })
  return NextResponse.json({ ok: true })
}
