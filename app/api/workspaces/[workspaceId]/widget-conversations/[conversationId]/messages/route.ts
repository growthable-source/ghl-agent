import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { broadcast } from '@/lib/widget-sse'

type Params = { params: Promise<{ workspaceId: string; conversationId: string }> }

/**
 * GET — full message history for one conversation (for the inbox detail view)
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widget: { workspaceId } },
    include: {
      widget: { select: { id: true, name: true, primaryColor: true } },
      visitor: { select: { id: true, name: true, email: true, firstSeenAt: true } },
      messages: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  return NextResponse.json({ conversation: convo })
}

/**
 * POST — human takeover. Post a message AS THE AGENT to the conversation,
 * bypassing AI. Broadcasts to any connected widget session via SSE.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 })

  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widget: { workspaceId } },
    select: { id: true, status: true },
  })
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  const msg = await db.widgetMessage.create({
    data: { conversationId, role: 'agent', content, kind: 'text' },
  })
  await db.widgetConversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: new Date(),
      ...(convo.status === 'active' ? { status: 'handed_off' } : {}),
    },
  })

  broadcast(conversationId, {
    type: 'agent_message',
    id: msg.id,
    content,
    createdAt: msg.createdAt.toISOString(),
    fromHuman: true,
  })

  return NextResponse.json({ messageId: msg.id })
}
