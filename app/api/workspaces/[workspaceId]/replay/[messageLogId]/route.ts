import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; messageLogId: string }> }

/**
 * GET — fetch the full conversation window surrounding a specific MessageLog,
 * so it can be "replayed" in the UI.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, messageLogId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  const locationIds = locations.map(l => l.id)

  const log = await db.messageLog.findUnique({
    where: { id: messageLogId },
    include: { agent: { select: { id: true, name: true, systemPrompt: true } } },
  })

  if (!log || !locationIds.includes(log.locationId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Pull the full conversation (all messages with this contactId + agentId)
  const conversation = await db.conversationMessage.findMany({
    where: {
      contactId: log.contactId,
      agentId: log.agentId!,
      locationId: log.locationId,
    },
    orderBy: { createdAt: 'asc' },
  })

  // Also grab any corrections for messages in this conversation
  const corrections = await db.messageCorrection.findMany({
    where: { messageLog: { contactId: log.contactId, agentId: log.agentId! } },
    select: { messageLogId: true, originalText: true, correctedText: true, createdAt: true },
  }).catch(() => [])

  return NextResponse.json({
    anchor: log,
    conversation,
    corrections,
    agent: log.agent,
  })
}
