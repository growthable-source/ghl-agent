import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { audit } from '@/lib/audit'

type Params = { params: Promise<{ workspaceId: string; takeoverId: string }> }

/**
 * PATCH — hand control back to the agent. Body: { action: 'end' }
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, takeoverId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {}

  if (body.action !== 'end') {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  }

  const takeover = await db.liveTakeover.findUnique({
    where: { id: takeoverId },
    select: { agentId: true, contactId: true, locationId: true, endedAt: true },
  })
  if (!takeover || takeover.endedAt) {
    return NextResponse.json({ error: 'Takeover not found or already ended' }, { status: 404 })
  }

  // End the takeover record
  await db.liveTakeover.update({
    where: { id: takeoverId },
    data: { endedAt: new Date() },
  })

  // Resume the agent's conversation state for this contact
  await db.conversationStateRecord.updateMany({
    where: { agentId: takeover.agentId, contactId: takeover.contactId, state: 'PAUSED', pauseReason: 'human_takeover' },
    data: { state: 'ACTIVE', pauseReason: null, resumedAt: new Date() },
  })

  await audit({
    workspaceId,
    actorId: access.session.user.id,
    action: 'conversation.takeover.end',
    targetType: 'contact',
    targetId: takeover.contactId,
    metadata: { agentId: takeover.agentId, takeoverId },
  })

  return NextResponse.json({ success: true })
}
