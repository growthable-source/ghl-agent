import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { getExperimentStats } from '@/lib/experiments'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/** GET → list experiments for this agent + per-experiment stats. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  let experiments: any[]
  try {
    experiments = await (db as any).agentExperiment.findMany({
      where: { agentId },
      orderBy: [{ status: 'asc' }, { proposedAt: 'desc' }],
    })
  } catch {
    return NextResponse.json({ experiments: [], notMigrated: true })
  }

  const withStats = await Promise.all(experiments.map(async e => ({
    ...e,
    stats: await getExperimentStats(e.id),
  })))
  return NextResponse.json({ experiments: withStats })
}

/** POST → create a new experiment as draft. */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const { hypothesis, variantBPrompt } = body
  if (!hypothesis || !variantBPrompt) {
    return NextResponse.json({ error: 'hypothesis and variantBPrompt required' }, { status: 400 })
  }

  const exp = await (db as any).agentExperiment.create({
    data: {
      agentId,
      hypothesis,
      variantALabel: body.variantALabel || 'control',
      variantBLabel: body.variantBLabel || 'variant-b',
      variantAPrompt: body.variantAPrompt || null,
      variantBPrompt,
      metric: body.metric || 'any_goal',
      splitPercent: typeof body.splitPercent === 'number' ? body.splitPercent : 50,
      status: 'draft',
      proposedBy: body.proposedBy || 'operator',
    },
  })
  return NextResponse.json({ experiment: exp })
}
