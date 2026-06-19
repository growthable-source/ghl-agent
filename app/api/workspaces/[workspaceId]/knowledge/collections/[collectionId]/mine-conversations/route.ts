import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { getAgentCrmLiveStatus, getCrmLiveStatus } from '@/lib/crm/connection-status'

type Params = { params: Promise<{ workspaceId: string; collectionId: string }> }

const DEFAULT_WINDOW_MONTHS = 12
const DEFAULT_MAX = 2000

/**
 * GET — runs + pending-pair summary for this collection, plus the connected
 * agents whose CRM is live (the only ones whose history can be mined). Drives
 * the staging tab badge, the "mining in progress" state, and the agent picker
 * in the confirm dialog.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, collectionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const [runs, pendingCount, attached] = await Promise.all([
    db.conversationMiningRun.findMany({
      where: { workspaceId, collectionId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    db.minedQaPair.count({ where: { collectionId, status: 'pending' } }),
    db.agentCollection.findMany({
      where: { collectionId },
      select: { agent: { select: { id: true, name: true, locationId: true } } },
    }),
  ])

  const mineableAgents: Array<{ id: string; name: string }> = []
  for (const row of attached) {
    const a = row.agent
    if (!a) continue
    const status = await getCrmLiveStatus(a.locationId)
    if (status.live) mineableAgents.push({ id: a.id, name: a.name })
  }

  return NextResponse.json({ runs, pendingCount, mineableAgents })
}

/**
 * POST — queue a mining run. Body: { agentId, windowStart?, windowEnd?, max? }.
 * 409 if the agent's CRM isn't live. The mine-conversations cron picks it up.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, collectionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const collection = await db.knowledgeCollection.findFirst({
    where: { id: collectionId, workspaceId },
    select: { id: true },
  })
  if (!collection) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const agentId = typeof body.agentId === 'string' ? body.agentId : ''
  if (!agentId) return NextResponse.json({ error: 'agentId required' }, { status: 400 })

  const agent = await db.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const live = await getAgentCrmLiveStatus(agentId)
  if (!live.live) {
    return NextResponse.json({ error: 'CRM not connected', reason: live.reason }, { status: 409 })
  }

  // Don't stack runs for the same collection — one active job at a time.
  const active = await db.conversationMiningRun.findFirst({
    where: { collectionId, status: { in: ['queued', 'running'] } },
    select: { id: true },
  })
  if (active) {
    return NextResponse.json({ error: 'A mining run is already in progress for this collection', runId: active.id }, { status: 409 })
  }

  const now = Date.now()
  const windowEnd = parseDate(body.windowEnd, new Date(now))
  const windowStart = parseDate(
    body.windowStart,
    new Date(new Date(now).setMonth(new Date(now).getMonth() - DEFAULT_WINDOW_MONTHS)),
  )
  const max = clampMax(body.max)

  const run = await db.conversationMiningRun.create({
    data: {
      workspaceId,
      agentId,
      collectionId,
      status: 'queued',
      windowStart,
      windowEnd,
      maxConversations: max,
      // 'auto' lets the engine pick the cheap default (OpenRouter when its key
      // is set, else deepseek-flash) — never Claude. miningModelKey() coerces
      // 'auto'/Claude keys; an explicit cheap key passed here is honoured.
      model: typeof body.model === 'string' ? body.model : 'auto',
    },
  })

  return NextResponse.json({ run }, { status: 201 })
}

function parseDate(raw: unknown, fallback: Date): Date {
  if (typeof raw !== 'string') return fallback
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? fallback : d
}

function clampMax(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? parseInt(raw, 10) : DEFAULT_MAX
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX
  return Math.min(n, 5000)
}
