import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { assignConversation } from '@/lib/widget-routing'

type Params = { params: Promise<{ workspaceId: string; conversationId: string }> }

/**
 * POST — assign / unassign / claim a conversation.
 *
 * Body shape:
 *   { userId: string }     → assign to that user (manual)
 *   { userId: null }       → unassign (back to the queue)
 *   { claim: true }        → assign to the caller (self-claim from queue)
 *
 * Reasons recorded on the conversation:
 *   - "manual" when an admin/teammate assigns
 *   - "self"   when the caller claims for themselves
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {}

  const claim = body?.claim === true
  let userId: string | null
  let reason: 'manual' | 'self' = 'manual'

  if (claim) {
    userId = access.session.user!.id
    reason = 'self'
  } else if (body && Object.prototype.hasOwnProperty.call(body, 'userId')) {
    if (body.userId === null) {
      userId = null
    } else if (typeof body.userId === 'string' && body.userId.length > 0) {
      userId = body.userId
    } else {
      return NextResponse.json({ error: 'userId must be a string or null' }, { status: 400 })
    }
  } else {
    return NextResponse.json({ error: 'Body must include userId or claim:true' }, { status: 400 })
  }

  // If assigning to a user, verify they're a member of the workspace.
  if (userId) {
    const member = await db.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { userId: true },
    })
    if (!member) {
      return NextResponse.json({ error: 'User is not a member of this workspace' }, { status: 400 })
    }
  }

  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widget: { workspaceId } },
    select: { id: true },
  })
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  await assignConversation({
    workspaceId,
    conversationId,
    userId,
    reason,
    // Don't send an "assigned to you" push to someone who just self-claimed —
    // they obviously already know.
    notifyAssignee: !claim,
  })
  return NextResponse.json({ ok: true, assignedUserId: userId })
}
