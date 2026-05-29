/**
 * Bulk-upsert canvas node positions. Called by AgentFlowCanvas with a
 * debounced batch of all dragged nodes after onNodeDragStop fires.
 *
 * Body: { positions: Array<{ nodeKey: string, x: number, y: number }> }
 *
 * Idempotent — re-PATCHing the same positions is a no-op apart from
 * updating `updatedAt`. Operations run sequentially in a transaction so
 * a mid-batch failure doesn't leave the agent's layout in a torn state.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as {
    positions?: Array<{ nodeKey?: unknown; x?: unknown; y?: unknown }>
  }
  if (!Array.isArray(body.positions)) {
    return NextResponse.json({ error: 'invalid_positions' }, { status: 400 })
  }

  const valid = body.positions.filter(
    (p): p is { nodeKey: string; x: number; y: number } =>
      typeof p?.nodeKey === 'string'
      && p.nodeKey.length > 0
      && typeof p?.x === 'number'
      && Number.isFinite(p.x)
      && typeof p?.y === 'number'
      && Number.isFinite(p.y),
  )

  // No-op if every entry was filtered out — return ok without touching the DB.
  if (valid.length === 0) {
    return NextResponse.json({ ok: true, updated: 0 })
  }

  await db.$transaction(
    valid.map(p => db.agentNodeLayout.upsert({
      where: { agentId_nodeKey: { agentId, nodeKey: p.nodeKey } },
      create: { agentId, nodeKey: p.nodeKey, x: p.x, y: p.y },
      update: { x: p.x, y: p.y },
    })),
  )

  return NextResponse.json({ ok: true, updated: valid.length })
}
