import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { getAgentCrmLiveStatus } from '@/lib/crm/connection-status'
import { estimateMining } from '@/lib/conversation-mining'

type Params = { params: Promise<{ workspaceId: string; collectionId: string }> }

const DEFAULT_WINDOW_MONTHS = 12
const DEFAULT_MAX = 2000

/**
 * GET — project the cost of mining a window before the operator commits.
 * Query: agentId, windowStart?, windowEnd?, max?
 * Returns { conversations, capped, estTokens, estUsd, model } or 409 when the
 * agent's CRM isn't connected.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId, collectionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const collection = await db.knowledgeCollection.findFirst({
    where: { id: collectionId, workspaceId },
    select: { id: true },
  })
  if (!collection) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })

  const url = new URL(req.url)
  const agentId = url.searchParams.get('agentId') ?? ''
  if (!agentId) return NextResponse.json({ error: 'agentId required' }, { status: 400 })

  // Confirm the agent belongs to this workspace and its CRM is live.
  const agent = await db.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  const live = await getAgentCrmLiveStatus(agentId)
  if (!live.live || !live.locationId) {
    return NextResponse.json({ error: 'CRM not connected', reason: live.reason }, { status: 409 })
  }

  const now = Date.now()
  const windowEnd = parseDate(url.searchParams.get('windowEnd'), new Date(now))
  const windowStart = parseDate(
    url.searchParams.get('windowStart'),
    new Date(new Date(now).setMonth(new Date(now).getMonth() - DEFAULT_WINDOW_MONTHS)),
  )
  const max = clampMax(url.searchParams.get('max'))

  try {
    const estimate = await estimateMining({ locationId: live.locationId, windowStart, windowEnd, max })
    return NextResponse.json({ estimate, windowStart, windowEnd, max })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Estimate failed' },
      { status: 502 },
    )
  }
}

function parseDate(raw: string | null, fallback: Date): Date {
  if (!raw) return fallback
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? fallback : d
}

function clampMax(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : DEFAULT_MAX
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX
  return Math.min(n, 5000)
}
