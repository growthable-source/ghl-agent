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

  let convo: any
  try {
    convo = await db.widgetConversation.findFirst({
      where: { id: conversationId, widget: { workspaceId } },
      include: {
        widget: { select: { id: true, name: true, primaryColor: true } },
        visitor: { select: { id: true, name: true, email: true, phone: true, firstSeenAt: true, lastSeenAt: true } },
        messages: { orderBy: { createdAt: 'asc' } },
        _count: { select: { messages: true } },
      },
    })
  } catch (err: any) {
    // CSAT migration may not be applied yet → don't fail the inbox.
    convo = await db.widgetConversation.findFirst({
      where: { id: conversationId, widget: { workspaceId } },
      include: {
        widget: { select: { id: true, name: true, primaryColor: true } },
        visitor: { select: { id: true, name: true, email: true, firstSeenAt: true } },
        messages: { orderBy: { createdAt: 'asc' } },
      },
    })
  }
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  // Best-effort visitor metadata. CSAT columns may not exist yet — degrade.
  let visitorConversationCount = 1
  let csatHistory: Array<{ rating: number; submittedAt: string | null }> = []
  try {
    const all = await (db as any).widgetConversation.findMany({
      where: { visitorId: convo.visitor.id },
      select: { id: true, csatRating: true, csatSubmittedAt: true },
    })
    visitorConversationCount = all.length
    csatHistory = all
      .filter((c: any) => typeof c.csatRating === 'number')
      .map((c: any) => ({
        rating: c.csatRating as number,
        submittedAt: c.csatSubmittedAt ? c.csatSubmittedAt.toISOString() : null,
      }))
  } catch { /* ignore */ }

  return NextResponse.json({
    conversation: {
      ...convo,
      visitorConversationCount,
      csatHistory,
    },
  })
}

/**
 * PATCH — update conversation status (mark resolved, reopen).
 * Body: { status: 'active' | 'handed_off' | 'ended' }
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const next = body.status as string
  if (!['active', 'handed_off', 'ended'].includes(next)) {
    return NextResponse.json({ error: 'status must be active | handed_off | ended' }, { status: 400 })
  }

  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widget: { workspaceId } },
    select: { id: true },
  })
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  await db.widgetConversation.update({
    where: { id: conversationId },
    data: { status: next },
  })
  broadcast(conversationId, { type: 'status_changed', status: next })

  // GHL bridge — fire-and-forget. On 'ended' write a transcript note +
  // resolved tag onto the contact so operators living in GHL have a
  // permanent record. Skipped silently when no CRM is connected.
  if (next === 'ended') {
    ;(async () => {
      try {
        const full = await db.widgetConversation.findUnique({
          where: { id: conversationId },
          include: { widget: true, visitor: true },
        })
        if (!full) return
        const { tagAndNoteOnResolve } = await import('@/lib/widget-crm-sync')
        await tagAndNoteOnResolve({
          workspaceId,
          visitor: full.visitor as any,
          conversationId,
          widgetName: full.widget.name || 'widget',
        })
      } catch (err: any) {
        console.warn('[widget] CRM resolve sync failed:', err?.message)
      }
    })()
  }
  return NextResponse.json({ ok: true, status: next })
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
    include: { visitor: true },
  })
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  const wasActive = convo.status === 'active'

  const msg = await db.widgetMessage.create({
    data: { conversationId, role: 'agent', content, kind: 'text' },
  })
  await db.widgetConversation.update({
    where: { id: conversationId },
    data: {
      lastMessageAt: new Date(),
      ...(wasActive ? { status: 'handed_off' } : {}),
    },
  })

  broadcast(conversationId, {
    type: 'agent_message',
    id: msg.id,
    content,
    createdAt: msg.createdAt.toISOString(),
    fromHuman: true,
  })

  // GHL bridge — first time an operator takes over, tag the contact so
  // the record reflects "human is on this." Fire-and-forget.
  if (wasActive) {
    ;(async () => {
      try {
        const { tagOnHandover } = await import('@/lib/widget-crm-sync')
        await tagOnHandover(workspaceId, convo.visitor as any)
      } catch (err: any) {
        console.warn('[widget] CRM handover tag failed:', err?.message)
      }
    })()
  }

  return NextResponse.json({ messageId: msg.id })
}
