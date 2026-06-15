import { NextRequest, NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { can } from '@/lib/permissions'
import { broadcast } from '@/lib/widget-sse'
import { notify } from '@/lib/notifications'
import { resolveHandoverLink } from '@/lib/handover-link'

type Params = { params: Promise<{ workspaceId: string; conversationId: string }> }

/**
 * POST — add an INTERNAL note to a conversation. Notes live in their own
 * table (never WidgetMessage) so no visitor-facing read path can surface
 * them; the live SSE event is gated out of the visitor stream. Posting a
 * note does NOT take over the chat or pause the AI. @mentioned teammates
 * get a personal notification.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  if (!can(access.role, 'conversations.reply')) {
    return NextResponse.json({ error: 'Your role is read-only — you can read this chat but not post notes.' }, { status: 403 })
  }

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const text = typeof body.body === 'string' ? body.body.trim() : ''
  if (!text) return NextResponse.json({ error: 'body required' }, { status: 400 })

  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widget: { workspaceId } },
    select: { id: true, widgetId: true, widget: { select: { name: true } } },
  })
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  // Validate @mentions against real, non-viewer members of THIS workspace.
  const rawMentions: string[] = Array.isArray(body.mentionedUserIds)
    ? body.mentionedUserIds.filter((x: unknown) => typeof x === 'string')
    : []
  let mentionedUserIds: string[] = []
  if (rawMentions.length > 0) {
    const members = await db.workspaceMember.findMany({
      where: { workspaceId, userId: { in: rawMentions }, role: { not: 'viewer' } },
      select: { userId: true },
    })
    mentionedUserIds = Array.from(new Set(members.map(m => m.userId)))
  }

  const authorId = access.session.user?.id ?? null
  const author = authorId
    ? await db.user.findUnique({ where: { id: authorId }, select: { name: true, email: true } }).catch(() => null)
    : null
  const authorName = author?.name ?? author?.email ?? 'A teammate'

  const note = await db.conversationNote.create({
    data: { conversationId, authorUserId: authorId, body: text.slice(0, 8000), mentionedUserIds },
  })

  // Live to the operator inbox only — the visitor stream drops this type.
  await broadcast(conversationId, {
    type: 'internal_note',
    id: note.id,
    body: note.body,
    authorName,
    mentionedUserIds,
    createdAt: note.createdAt.toISOString(),
  })

  // Notify each @mentioned teammate (skip the author mentioning themselves).
  if (mentionedUserIds.length > 0) {
    after(async () => {
      const link = resolveHandoverLink({
        workspaceId,
        locationId: `widget:${convo.widgetId}`,
        conversationId,
        channel: 'Live_Chat',
      })
      for (const userId of mentionedUserIds) {
        if (userId === authorId) continue
        try {
          await notify({
            workspaceId,
            event: 'widget.conversation_mention',
            title: `${authorName} mentioned you in a chat note`,
            body: note.body.slice(0, 200),
            link,
            severity: 'info',
            targetUserId: userId,
          })
        } catch (err: any) {
          console.warn('[notes] mention notify failed:', err?.message)
        }
      }
    })
  }

  return NextResponse.json({
    note: {
      id: note.id,
      body: note.body,
      authorName,
      mentionedUserIds,
      createdAt: note.createdAt.toISOString(),
    },
  })
}
