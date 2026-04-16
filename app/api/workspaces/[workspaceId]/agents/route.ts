import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { canCreateAgent, isTrialExpired } from '@/lib/plans'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agents = await db.agent.findMany({
    where: { workspaceId },
    include: {
      _count: { select: { knowledgeEntries: true, routingRules: true, messageLogs: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ agents })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // ─── Feature gating: check agent limit ───
  let workspace: { plan: string; agentLimit: number; extraAgentCount: number; trialEndsAt: Date | null } | null = null
  try {
    workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { plan: true, agentLimit: true, extraAgentCount: true, trialEndsAt: true },
    })
  } catch {
    // Columns may not exist yet if billing migration hasn't been run — skip gating
    console.warn('[Agents] Feature gating query failed (migration pending?) — allowing agent creation')
  }

  if (workspace) {
    // Block expired trials
    if (workspace.plan === 'trial' && isTrialExpired(workspace.trialEndsAt)) {
      return NextResponse.json({
        error: 'Your trial has expired. Please upgrade to continue creating agents.',
        code: 'TRIAL_EXPIRED',
      }, { status: 403 })
    }

    const currentAgentCount = await db.agent.count({ where: { workspaceId } })
    if (!canCreateAgent(workspace.plan, currentAgentCount, workspace.extraAgentCount ?? 0)) {
      return NextResponse.json({
        error: `Agent limit reached (${currentAgentCount}/${workspace.agentLimit}). Upgrade your plan or add extra agent slots.`,
        code: 'AGENT_LIMIT',
        currentCount: currentAgentCount,
        limit: workspace.agentLimit,
      }, { status: 403 })
    }
  }

  const body = await req.json()
  const location = await db.location.findFirst({ where: { workspaceId }, select: { id: true } })
  const agent = await db.agent.create({
    data: {
      workspaceId,
      locationId: location?.id ?? workspaceId,
      name: body.name,
      systemPrompt: body.systemPrompt,
      instructions: body.instructions ?? null,
      ...(body.enabledTools !== undefined && { enabledTools: body.enabledTools }),
    },
  })
  return NextResponse.json({ agent }, { status: 201 })
}
