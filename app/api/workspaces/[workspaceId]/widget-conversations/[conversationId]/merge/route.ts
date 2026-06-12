import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { can } from '@/lib/permissions'
import { broadcast } from '@/lib/widget-sse'

type Params = { params: Promise<{ workspaceId: string; conversationId: string }> }

/**
 * Conversation merge.
 *
 * Use case (from support): a visitor's first chat goes quiet, then they
 * come back in a NEW session with the same issue. The operator wants the
 * two threads combined so the history reads as one conversation instead
 * of being split across two inbox rows.
 *
 * GET  — list merge candidates for THIS conversation. Same visitor's
 *        other (non-merged) conversations come first; we also surface
 *        other conversations from the same email/visitor identity. Each
 *        carries a short preview so the operator can confirm it's the
 *        right thread before merging.
 *
 * POST { sourceConversationId } — merge the SOURCE thread INTO this one
 *        (this conversation is the survivor/target). All of the source's
 *        messages move onto the target (timestamps preserved, so the
 *        combined thread reads in chronological order), the source is
 *        marked ended + mergedIntoId, and any linked ticket is carried
 *        over when the target doesn't already have one.
 */

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const target = await db.widgetConversation.findFirst({
    where: { id: conversationId, widget: { workspaceId } },
    select: { id: true, visitorId: true, visitor: { select: { email: true } } },
  })
  if (!target) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  // Candidate visitor ids: this visitor, plus any visitor in the same
  // workspace sharing this email (covers the "came back on another
  // device" case where the cookie — and therefore the visitor row —
  // differs but the person is the same).
  const visitorIds = new Set<string>([target.visitorId])
  const email = target.visitor?.email?.trim()
  if (email) {
    try {
      const sameEmail = await db.widgetVisitor.findMany({
        where: { email, widget: { workspaceId } },
        select: { id: true },
        take: 50,
      })
      for (const v of sameEmail) visitorIds.add(v.id)
    } catch { /* email column / index variance — ignore, fall back to same-visitor only */ }
  }

  let rows: any[] = []
  try {
    rows = await db.widgetConversation.findMany({
      where: {
        widget: { workspaceId },
        visitorId: { in: Array.from(visitorIds) },
        id: { not: conversationId },
        // Don't offer threads that were already merged away.
        mergedIntoId: null,
      } as any,
      orderBy: { lastMessageAt: 'desc' },
      take: 25,
      select: {
        id: true,
        status: true,
        createdAt: true,
        lastMessageAt: true,
        _count: { select: { messages: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, role: true, kind: true } },
      } as any,
    })
  } catch {
    // mergedIntoId column not migrated yet — degrade to same-visitor list
    // without the merged-away filter.
    rows = await db.widgetConversation.findMany({
      where: { widget: { workspaceId }, visitorId: { in: Array.from(visitorIds) }, id: { not: conversationId } },
      orderBy: { lastMessageAt: 'desc' },
      take: 25,
      select: {
        id: true, status: true, createdAt: true, lastMessageAt: true,
        _count: { select: { messages: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, role: true, kind: true } },
      } as any,
    })
  }

  const candidates = rows.map(r => {
    const last = r.messages?.[0]
    const preview = last
      ? (last.kind === 'text' ? String(last.content).slice(0, 90) : `[${last.kind}]`)
      : '(no messages)'
    return {
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      lastMessageAt: r.lastMessageAt,
      messageCount: r._count?.messages ?? 0,
      preview,
    }
  })

  return NextResponse.json({ candidates })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  // Merging rewrites conversation history — a reply-capable action, not
  // something a read-only viewer should do.
  if (!can(access.role, 'conversations.reply')) {
    return NextResponse.json({ error: 'Your role is read-only — you can view conversations but not merge them.' }, { status: 403 })
  }

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const sourceId = typeof body.sourceConversationId === 'string' ? body.sourceConversationId : ''
  if (!sourceId) return NextResponse.json({ error: 'sourceConversationId required' }, { status: 400 })
  if (sourceId === conversationId) return NextResponse.json({ error: "Can't merge a conversation into itself." }, { status: 400 })

  // Both threads must live in this workspace.
  const [target, source] = await Promise.all([
    db.widgetConversation.findFirst({
      where: { id: conversationId, widget: { workspaceId } },
      select: { id: true, widgetId: true },
    }),
    db.widgetConversation.findFirst({
      where: { id: sourceId, widget: { workspaceId } },
      select: { id: true, lastMessageAt: true },
    }),
  ])
  if (!target) return NextResponse.json({ error: 'Target conversation not found' }, { status: 404 })
  if (!source) return NextResponse.json({ error: 'Source conversation not found' }, { status: 404 })

  // Move the source's messages onto the target. Timestamps are
  // preserved, and the inbox renders messages ordered by createdAt, so
  // the combined thread reads chronologically with no reordering needed.
  const moved = await db.widgetMessage.updateMany({
    where: { conversationId: sourceId },
    data: { conversationId },
  })

  // Carry a linked ticket over only when the target has none (the
  // Ticket↔conversation link is unique, so we can't point two at one).
  try {
    const [targetTicket, sourceTicket] = await Promise.all([
      (db as any).ticket.findUnique({ where: { conversationId }, select: { id: true } }),
      (db as any).ticket.findUnique({ where: { conversationId: sourceId }, select: { id: true } }),
    ])
    if (sourceTicket && !targetTicket) {
      await (db as any).ticket.update({ where: { id: sourceTicket.id }, data: { conversationId } })
    }
  } catch { /* ticket table absent / not migrated — nothing to carry */ }

  // Keep the target's last-activity timestamp honest after absorbing the
  // source's (possibly newer) messages.
  const newest = await db.widgetMessage.findFirst({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })

  await db.widgetConversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: newest?.createdAt ?? new Date() },
  })

  // Retire the source: end it and point it at the survivor so anyone who
  // opens its old inbox row / deep-link can be redirected to the merged
  // thread. Tolerate the mergedIntoId column being pre-migration.
  try {
    await db.widgetConversation.update({
      where: { id: sourceId },
      data: { status: 'ended', mergedIntoId: conversationId } as any,
    })
  } catch (err: any) {
    if (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')) {
      await db.widgetConversation.update({ where: { id: sourceId }, data: { status: 'ended' } })
    } else { throw err }
  }

  // Tell any open view of the source it's done.
  await broadcast(sourceId, { type: 'status_changed', status: 'ended' }).catch(() => {})

  return NextResponse.json({ ok: true, mergedMessages: moved.count, into: conversationId })
}
