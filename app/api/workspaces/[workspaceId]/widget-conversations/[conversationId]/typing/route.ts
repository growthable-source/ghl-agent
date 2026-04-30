import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { broadcast } from '@/lib/widget-sse'

type Params = { params: Promise<{ workspaceId: string; conversationId: string }> }

/**
 * POST /typing  body: { isTyping }
 * Operator-side typing indicator. Pure broadcast — no DB write. The
 * visitor's widget shows "Someone is typing…" so they hold their reply.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widget: { workspaceId } },
    select: { id: true },
  })
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  let body: any = {}
  try { body = await req.json() } catch {}
  const isTyping = !!body.isTyping
  // Broadcast as agent_typing so the visitor widget treats it the same
  // as AI typing — fromHuman=true differentiates the source for any
  // operator-side subscriber that cares.
  await broadcast(conversationId, { type: 'agent_typing', isTyping, fromHuman: true })
  return NextResponse.json({ ok: true })
}
