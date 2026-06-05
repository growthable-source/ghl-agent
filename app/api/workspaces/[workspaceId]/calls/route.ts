/**
 * GET /api/workspaces/:workspaceId/calls?agentId=...&limit=20
 *
 * Workspace-wide CallLog list. Filterable by agentId so the per-agent
 * voice surface can show its own activity without pulling every call
 * in the workspace. Honours the dashboard session via
 * requireWorkspaceAccess.
 *
 * Returns: { calls: Array<{ id, agentId, agentName, callerPhone,
 * status, durationSec, direction, createdAt }> }
 *
 * Used by:
 *   - /dashboard/[wsId]/voice/page.tsx  (recent activity feed)
 *   - /dashboard/[wsId]/voice/[agentId]/page.tsx  (per-agent overview)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agentId = req.nextUrl.searchParams.get('agentId') || null
  const limitRaw = parseInt(req.nextUrl.searchParams.get('limit') || '20', 10)
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20))

  // Scope by workspace via the location -> workspace join. CallLog
  // doesn't have a workspaceId column; we narrow by the locations that
  // belong to this workspace, optionally further by agentId.
  const locations = await db.location.findMany({
    where: { workspaceId },
    select: { id: true },
  })
  const locationIds = locations.map(l => l.id)
  if (locationIds.length === 0) return NextResponse.json({ calls: [] })

  const where: Record<string, unknown> = { locationId: { in: locationIds } }
  if (agentId) where.agentId = agentId

  const rows = await db.callLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      agentId: true,
      contactPhone: true,
      status: true,
      durationSecs: true,
      direction: true,
      createdAt: true,
    },
  })

  // Hydrate agent names in one extra query so the workspace-wide feed
  // can display them without N round-trips.
  const ids = Array.from(new Set(rows.map(r => r.agentId).filter((x): x is string => !!x)))
  const agentNames = ids.length === 0 ? new Map<string, string>() : new Map(
    (await db.agent.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    })).map(a => [a.id, a.name]),
  )

  return NextResponse.json({
    calls: rows.map(r => ({
      id: r.id,
      agentId: r.agentId,
      agentName: r.agentId ? (agentNames.get(r.agentId) ?? 'Unknown agent') : null,
      callerPhone: r.contactPhone,
      status: r.status,
      durationSec: r.durationSecs,
      direction: r.direction,
      createdAt: r.createdAt.toISOString(),
    })),
  })
}
