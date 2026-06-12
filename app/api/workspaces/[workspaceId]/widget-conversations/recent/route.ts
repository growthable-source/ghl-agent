import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:workspaceId/widget-conversations/recent
 *
 * Recent visitor-initiated live chats, for the on-screen "new chat
 * incoming" popup. Cheap + polled: returns the few newest conversations
 * (last ~10 min, capped at 30 min) that have an actual visitor message
 * and aren't ended. The client tracks which ids it has already alerted
 * on, so this just needs to report what's recent — not what's "new."
 *
 * `?since=<iso>` narrows the window to conversations created after that
 * timestamp (the client passes its last successful poll time).
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const sinceParam = req.nextUrl.searchParams.get('since')
  const requested = sinceParam ? new Date(sinceParam) : new Date(Date.now() - 10 * 60 * 1000)
  const floor = new Date(Date.now() - 30 * 60 * 1000) // never look further back than 30 min
  const since = isNaN(requested.getTime()) || requested < floor ? floor : requested

  let rows: any[] = []
  try {
    rows = await db.widgetConversation.findMany({
      where: {
        widget: { workspaceId },
        createdAt: { gte: since },
        status: { in: ['active', 'handed_off'] },
        // A real chat — the visitor actually said something, not just an
        // opened-and-abandoned widget with only the welcome line.
        messages: { some: { role: 'visitor' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        createdAt: true,
        assignedUserId: true,
        widget: { select: { name: true } },
        visitor: { select: { name: true, email: true } },
        messages: {
          where: { role: 'visitor' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { content: true, kind: true },
        },
      } as any,
    })
  } catch {
    // Schema variance pre-migration — degrade to an empty list rather
    // than 500ing a polled endpoint.
    rows = []
  }

  const chats = rows.map(r => {
    const first = r.messages?.[0]
    const preview = first
      ? (first.kind === 'text' ? String(first.content).slice(0, 120) : `[${first.kind}]`)
      : ''
    return {
      id: r.id,
      createdAt: r.createdAt,
      assigned: !!r.assignedUserId,
      widgetName: r.widget?.name ?? 'your widget',
      visitorLabel: r.visitor?.name || r.visitor?.email || 'A visitor',
      preview,
    }
  })

  return NextResponse.json({ chats })
}
