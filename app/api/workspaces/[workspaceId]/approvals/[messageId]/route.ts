import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { audit } from '@/lib/audit'
import { sendMessage } from '@/lib/crm-client'
import type { MessageChannelType } from '@/types'

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
    select: {
      id: true, locationId: true, contactId: true,
      needsApproval: true, approvalStatus: true, outboundReply: true,
      approvalChannel: true, approvalConversationProviderId: true,
    } as any,
  }) as any
  if (!log || !locationIds.includes(log.locationId)) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }

  // Idempotency — don't re-send if already approved/rejected
  if (log.approvalStatus && log.approvalStatus !== 'pending') {
    return NextResponse.json({ error: `Already ${log.approvalStatus}` }, { status: 409 })
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

  // If approved, ACTUALLY SEND the reply — this is the critical moment.
  // The message was captured at runAgent time but held in the queue;
  // now we release it. If the send fails, revert status so the user
  // can retry.
  if (body.action === 'approve' && updated.outboundReply) {
    try {
      await sendMessage(updated.locationId, {
        type: ((log as any).approvalChannel || 'SMS') as MessageChannelType,
        contactId: updated.contactId,
        conversationProviderId: (log as any).approvalConversationProviderId || undefined,
        message: updated.outboundReply,
      })
    } catch (err: any) {
      console.error('[Approvals] Failed to send approved message:', err.message)
      // Revert status so the user can retry from the UI
      await db.messageLog.update({
        where: { id: messageId },
        data: { approvalStatus: 'pending', approvedBy: null, approvedAt: null },
      })
      return NextResponse.json({
        error: `Failed to send: ${err.message}. Approval reverted — try again or edit the message.`,
      }, { status: 502 })
    }
  }

  audit({
    workspaceId,
    actorId: access.session.user.id,
    action: body.action === 'approve' ? 'message.approved' : 'message.rejected',
    targetType: 'message',
    targetId: messageId,
    metadata: body.editedReply ? { edited: true } : undefined,
  }).catch(() => {})

  return NextResponse.json({ log: updated })
}
