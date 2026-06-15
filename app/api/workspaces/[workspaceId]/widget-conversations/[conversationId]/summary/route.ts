import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { generateConversationSummary } from '@/lib/conversation-summary'

type Params = { params: Promise<{ workspaceId: string; conversationId: string }> }

/**
 * GET /api/workspaces/:ws/widget-conversations/:cid/summary
 *   Returns the cached summary, if any.
 * POST /api/workspaces/:ws/widget-conversations/:cid/summary
 *   Generates (or regenerates) a Haiku summary and caches it on the
 *   WidgetConversation row. Body can include `{ force: true }` to
 *   bypass the cache freshness check.
 *
 * Two-tier read: GET is free, POST burns one Haiku call. The inbox
 * shows the cached one immediately and gives the operator a "refresh"
 * affordance.
 */

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  try {
    const convo = await (db as any).widgetConversation.findFirst({
      where: { id: conversationId, widget: { workspaceId } },
      select: { aiSummary: true, aiSummaryAt: true },
    })
    if (!convo) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({
      summary: convo.aiSummary ?? null,
      summaryAt: convo.aiSummaryAt?.toISOString() ?? null,
    })
  } catch (err: any) {
    if (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ summary: null, summaryAt: null, notMigrated: true })
    }
    throw err
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {}
  const force = body?.force === true

  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widget: { workspaceId } },
    select: { id: true },
  })
  if (!convo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const result = await generateConversationSummary(conversationId, { force })
  if (!result) return NextResponse.json({ summary: null, summaryAt: null, empty: true })
  return NextResponse.json({ summary: result.summary, summaryAt: result.summaryAt.toISOString() })
}
