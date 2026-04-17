import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:workspaceId/decisions
 *
 * Returns recent messages with their full decision trace (toolCallTrace)
 * for explainability. Agents that took tool actions are surfaced first.
 *
 * Query:
 *   - agentId: filter to one agent
 *   - onlyActions: 'true' → only show messages that triggered tool calls
 *   - limit: default 50
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const agentId = url.searchParams.get('agentId')
  const onlyActions = url.searchParams.get('onlyActions') === 'true'
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200)

  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  const locationIds = locations.map(l => l.id)

  const logs = await db.messageLog.findMany({
    where: {
      locationId: { in: locationIds },
      ...(agentId ? { agentId } : {}),
      ...(onlyActions ? { actionsPerformed: { isEmpty: false } } : {}),
    },
    include: { agent: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return NextResponse.json({
    decisions: logs.map(l => ({
      id: l.id,
      createdAt: l.createdAt,
      contactId: l.contactId,
      conversationId: l.conversationId,
      agent: l.agent,
      status: l.status,
      inboundMessage: l.inboundMessage,
      outboundReply: l.outboundReply,
      actionsPerformed: l.actionsPerformed,
      tokensUsed: l.tokensUsed,
      toolCallTrace: l.toolCallTrace,
      errorMessage: l.errorMessage,
    })),
  })
}
