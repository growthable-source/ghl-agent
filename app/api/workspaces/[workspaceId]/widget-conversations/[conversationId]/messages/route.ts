import { NextRequest, NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { can } from '@/lib/permissions'
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
        widget: {
          select: {
            id: true, name: true, primaryColor: true,
            // Operator-facing whitelabel link, surfaced in the panel as a
            // quick "open the client's site" shortcut. Nullable.
            agencyUrl: true,
            // Brand is shown as a chip in the visitor sidebar; nullable
            // because not every workspace has brands defined.
            brand: { select: { id: true, name: true, slug: true, logoUrl: true, primaryColor: true, loginUrl: true } },
          },
        },
        visitor: { select: { id: true, name: true, email: true, phone: true, crmContactId: true, firstSeenAt: true, lastSeenAt: true } },
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

  // Previous context for a returning visitor (#5 prior-interactions):
  // summaries of this visitor's earlier ENDED chats so the operator sees
  // what was discussed last time, without opening old threads. Uses the
  // auto-generated aiSummary; CRM-linked contacts also get their
  // cross-channel ContactMemory summary. Best-effort + tolerant.
  let priorContext: Array<{ id: string; summary: string; at: string }> = []
  let contactMemory: string | null = null
  try {
    const prior = await (db as any).widgetConversation.findMany({
      where: {
        visitorId: convo.visitor.id,
        id: { not: conversationId },
        status: 'ended',
        aiSummary: { not: null },
      },
      select: { id: true, aiSummary: true, lastMessageAt: true },
      orderBy: { lastMessageAt: 'desc' },
      take: 3,
    })
    priorContext = prior
      .filter((c: any) => c.aiSummary)
      .map((c: any) => ({ id: c.id, summary: c.aiSummary as string, at: c.lastMessageAt.toISOString() }))
  } catch { /* aiSummary column missing pre-migration — skip */ }
  try {
    const crmContactId = (convo.visitor as any).crmContactId
    if (crmContactId && (convo as any).agentId) {
      const mem = await (db as any).contactMemory.findUnique({
        where: { agentId_contactId: { agentId: (convo as any).agentId, contactId: crmContactId } },
        select: { summary: true },
      })
      contactMemory = mem?.summary ?? null
    }
  } catch { /* table/relation missing — skip */ }

  // Probe for a linked ticket so the inbox can show "🎫 Ticket #N"
  // without a second client round-trip. Pre-migration workspaces don't
  // have the Ticket table — silently degrade to null.
  let ticket: { id: string; ticketNumber: number; status: string } | null = null
  try {
    ticket = await (db as any).ticket.findUnique({
      where: { conversationId },
      select: { id: true, ticketNumber: true, status: true },
    })
  } catch { /* table missing */ }

  // Merge internal notes into the thread (operator-only — notes are a
  // separate table the visitor never queries). Rendered inline as
  // kind='note' pseudo-messages, ordered with the real messages.
  try {
    const notes = await db.conversationNote.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { name: true, email: true } } },
    })
    if (notes.length > 0) {
      const noteMessages = notes.map(n => ({
        id: n.id,
        conversationId,
        role: 'agent',
        content: n.body,
        kind: 'note',
        language: null,
        translationEn: null,
        mentionedUserIds: n.mentionedUserIds,
        authorName: n.author?.name ?? n.author?.email ?? 'A teammate',
        createdAt: n.createdAt,
      }))
      convo.messages = [...convo.messages, ...noteMessages].sort(
        (a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      )
    }
  } catch { /* table missing pre-migration — skip notes */ }

  return NextResponse.json({
    conversation: {
      ...convo,
      visitorConversationCount,
      csatHistory,
      priorContext,
      contactMemory,
      ticket,
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
  // Changing status (take over / resolve / reopen) is a conversation
  // mutation — viewers are read-only and must not be able to do it.
  if (!can(access.role, 'conversations.reply')) {
    return NextResponse.json({ error: 'Your role is read-only — you can view conversations but not change them.' }, { status: 403 })
  }

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

  // When the operator resumes the AI (status flips from handed_off
  // back to active), ALSO resume any paused ConversationStateRecord
  // for this conversation. The formal takeover endpoint pauses
  // ConversationStateRecord with state='PAUSED'; without unpausing
  // here, the widget-agent-runner's shouldAgentReply check would
  // still see PAUSED and refuse to reply even though the operator
  // explicitly clicked "Resume AI."
  if (next === 'active') {
    try {
      await db.conversationStateRecord.updateMany({
        where: { conversationId, state: 'PAUSED', pauseReason: 'human_takeover' },
        data: { state: 'ACTIVE', pauseReason: null, resumedAt: new Date() },
      })
    } catch (err: any) {
      console.warn('[widget] resume on status=active failed:', err?.message)
    }
  }

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
    // Auto-generate the operator summary when a chat ends so it's ready
    // the next time anyone opens or promotes it — no manual "Generate".
    after(async () => {
      try {
        const { generateConversationSummary } = await import('@/lib/conversation-summary')
        await generateConversationSummary(conversationId, { force: true })
      } catch (err: any) {
        console.warn('[widget] end-of-chat summary failed:', err?.message)
      }
    })
    // A live human chat just ended → a queue slot may have freed up.
    after(async () => {
      try {
        const { advanceQueue } = await import('@/lib/widget-routing')
        await advanceQueue(workspaceId)
      } catch (err: any) {
        console.warn('[widget] advanceQueue on end failed:', err?.message)
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
  // Replying takes over the chat from the AI — viewers can't. Only roles
  // with conversations.reply (owner/admin/member/support-agent) may post.
  if (!can(access.role, 'conversations.reply')) {
    return NextResponse.json({ error: 'Your role is read-only — you can read this chat but not reply.' }, { status: 403 })
  }

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
    // Stamp the operator so this reply is permanently attributable to a
    // human (vs the AI, which leaves sentByUserId null) in every view.
    data: { conversationId, role: 'agent', content, kind: 'text', sentByUserId: access.session.user?.id ?? null },
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
