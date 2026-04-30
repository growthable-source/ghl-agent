import { NextRequest, NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { broadcast } from '@/lib/widget-sse'

// Background work (auto-routing, CRM sync, self-assign) runs via after()
// after the JSON response. maxDuration covers those tails on Vercel.
export const maxDuration = 60

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
        assignedUser: { select: { id: true, name: true, email: true, image: true } },
        _count: { select: { messages: true } },
      } as any,
    })
  } catch (err: any) {
    // CSAT or routing-assignment migration may not be applied yet → don't
    // fail the inbox. Fall back to the bare include.
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
  await broadcast(conversationId, { type: 'status_changed', status: next })

  // Status hit "handed_off" — auto-route per the widget's config so an
  // operator gets a heads-up immediately, instead of the chat sitting in
  // a queue waiting for someone to notice. Wrapped in after() so the
  // serverless runtime keeps it alive past the JSON response.
  if (next === 'handed_off') {
    after(async () => {
      try {
        const { autoRouteIfUnassigned } = await import('@/lib/widget-routing')
        await autoRouteIfUnassigned({ workspaceId, conversationId })
      } catch (err: any) {
        console.warn('[widget] auto-route on handover failed:', err?.message)
      }
    })
  }

  // GHL bridge — runs after the response. On 'ended' write a transcript
  // note + resolved tag onto the contact so operators living in GHL have
  // a permanent record. Skipped silently when no CRM is connected.
  if (next === 'ended') {
    after(async () => {
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
    })
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
  // Read assignedUserId off the row defensively — column may not exist
  // pre-migration. Self-assignment kicks in only when the chat is
  // currently unassigned and the caller is the one replying.
  const wasUnassigned = (convo as any).assignedUserId == null

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

  await broadcast(conversationId, {
    type: 'agent_message',
    id: msg.id,
    content,
    createdAt: msg.createdAt.toISOString(),
    fromHuman: true,
  })

  // GHL bridge — first time an operator takes over, tag the contact so
  // the record reflects "human is on this." Wrapped in after() so the
  // tag write isn't killed when the function suspends.
  if (wasActive) {
    after(async () => {
      try {
        const { tagOnHandover } = await import('@/lib/widget-crm-sync')
        await tagOnHandover(workspaceId, convo.visitor as any)
      } catch (err: any) {
        console.warn('[widget] CRM handover tag failed:', err?.message)
      }
    })
  }

  // Operator self-assignment — if the chat had no assignee, replying
  // claims it. This mirrors Intercom: whoever picks up a thread becomes
  // the de-facto owner unless someone reassigns later.
  if (wasUnassigned && access.session.user?.id) {
    after(async () => {
      try {
        const { assignConversation } = await import('@/lib/widget-routing')
        await assignConversation({
          workspaceId,
          conversationId,
          userId: access.session.user!.id,
          reason: 'self',
          notifyAssignee: false,
        })
      } catch (err: any) {
        console.warn('[widget] self-assign failed:', err?.message)
      }
    })
  }

  return NextResponse.json({ messageId: msg.id })
}
