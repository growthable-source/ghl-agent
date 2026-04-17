import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; messageId: string }> }

/**
 * PATCH /api/workspaces/:workspaceId/approvals/:messageId
 * Body: { action: 'approve' | 'reject', editedReply?: string }
 *
 * Marks an approval decision on a held message. If editedReply is provided
 * along with approve, the outbound text is updated before release.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, messageId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: { action?: string; editedReply?: string } = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (body.action !== 'approve' && body.action !== 'reject') {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  }

  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  const locationIds = locations.map(l => l.id)

  const log = await db.messageLog.findUnique({
    where: { id: messageId },
    select: { id: true, locationId: true, needsApproval: true, approvalStatus: true, outboundReply: true },
  })
  if (!log || !locationIds.includes(log.locationId)) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  const updated = await db.messageLog.update({
    where: { id: messageId },
    data: {
      approvalStatus: body.action === 'approve' ? 'approved' : 'rejected',
      approvedBy: access.session.user.id,
      approvedAt: new Date(),
      ...(body.action === 'approve' && body.editedReply ? { outboundReply: body.editedReply } : {}),
    },
  })

  // If approved, downstream send-message pipeline will detect status transition
  // and deliver the outboundReply via the CRM client. Rejected messages will be
  // discarded (nothing sent to the contact).

  return NextResponse.json({ log: updated })
}
