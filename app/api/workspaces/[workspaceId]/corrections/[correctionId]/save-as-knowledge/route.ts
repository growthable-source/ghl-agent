import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { createKnowledgeForAgent } from '@/lib/knowledge'

type Params = { params: Promise<{ workspaceId: string; correctionId: string }> }

/**
 * POST — convert a correction into a permanent knowledge base entry on the
 * agent that made the (originally incorrect) reply. Body: { title }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, correctionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: { title?: string } = {}
  try { body = await req.json() } catch {}

  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  const locationIds = locations.map(l => l.id)

  const correction = await db.messageCorrection.findUnique({
    where: { id: correctionId },
    include: {
      messageLog: {
        select: { locationId: true, agentId: true, inboundMessage: true, contactId: true },
      },
    },
  })

  if (!correction || !locationIds.includes(correction.messageLog.locationId)) {
    return NextResponse.json({ error: 'Correction not found' }, { status: 404 })
  }
  if (!correction.messageLog.agentId) {
    return NextResponse.json({ error: 'No agent on original message' }, { status: 400 })
  }

  const title = (body.title || correction.messageLog.inboundMessage.slice(0, 60) + '...').trim()

  try {
    const entry = await createKnowledgeForAgent({
      agentId: correction.messageLog.agentId,
      title,
      content: `When a contact asks something like: "${correction.messageLog.inboundMessage}"\n\nRespond: ${correction.correctedText}`,
      source: 'correction',
    })
    await db.messageCorrection.update({
      where: { id: correctionId },
      data: { savedAsKnowledge: true },
    })
    return NextResponse.json({ entry })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
