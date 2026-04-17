import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:workspaceId/corrections
 * List past message corrections — useful as training signal.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  const locationIds = locations.map(l => l.id)
  if (locationIds.length === 0) return NextResponse.json({ corrections: [] })

  try {
    const corrections = await db.messageCorrection.findMany({
      where: {
        messageLog: { locationId: { in: locationIds } },
      },
      include: {
        messageLog: {
          select: {
            id: true, createdAt: true, contactId: true, inboundMessage: true,
            agent: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return NextResponse.json({ corrections })
  } catch {
    return NextResponse.json({ corrections: [], notMigrated: true })
  }
}

/**
 * POST /api/workspaces/:workspaceId/corrections
 * Body: { messageLogId, correctedText, reason? }
 *
 * Save a human correction for an agent reply. The corrected text also
 * replaces the outboundReply on the message log so the view shows the
 * delivered text moving forward.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: { messageLogId?: string; correctedText?: string; reason?: string } = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (!body.messageLogId || !body.correctedText) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  const locationIds = locations.map(l => l.id)

  const log = await db.messageLog.findUnique({
    where: { id: body.messageLogId },
    select: { id: true, locationId: true, outboundReply: true },
  })
  if (!log || !locationIds.includes(log.locationId)) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  try {
    const correction = await db.messageCorrection.create({
      data: {
        messageLogId: body.messageLogId,
        originalText: log.outboundReply || '',
        correctedText: body.correctedText,
        correctedBy: access.session.user.id,
        reason: body.reason || null,
      },
    })

    // Update the message log so future views show the corrected text
    await db.messageLog.update({
      where: { id: body.messageLogId },
      data: { outboundReply: body.correctedText },
    })

    return NextResponse.json({ correction })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to save correction' }, { status: 500 })
  }
}
