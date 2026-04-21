import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { audit } from '@/lib/audit'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET — list active takeovers for this workspace.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  const locationIds = locations.map(l => l.id)
  if (locationIds.length === 0) return NextResponse.json({ takeovers: [] })

  try {
    const takeovers = await db.liveTakeover.findMany({
      where: { locationId: { in: locationIds }, endedAt: null },
      orderBy: { startedAt: 'desc' },
    })
    return NextResponse.json({ takeovers })
  } catch {
    return NextResponse.json({ takeovers: [], notMigrated: true })
  }
}

/**
 * POST — start a new takeover.
 * Body: { agentId, contactId, conversationId?, reason? }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (!body.agentId || !body.contactId) {
    return NextResponse.json({ error: 'agentId and contactId required' }, { status: 400 })
  }

  // Look up the agent by id, then verify workspace access via the
  // location FK — handles legacy rows where Agent.workspaceId is null
  // (the old direct-filter path returned "Agent not found" for those).
  const agent = await db.agent.findUnique({
    where: { id: body.agentId },
    select: {
      locationId: true,
      workspaceId: true,
      location: { select: { workspaceId: true } },
    },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  const inWorkspace =
    agent.workspaceId === workspaceId ||
    agent.location?.workspaceId === workspaceId
  if (!inWorkspace) {
    return NextResponse.json({ error: 'Agent not in this workspace' }, { status: 403 })
  }

  try {
    // Pause the agent's conversation state for this contact (so it won't auto-reply)
    await db.conversationStateRecord.upsert({
      where: { agentId_contactId: { agentId: body.agentId, contactId: body.contactId } },
      update: { state: 'PAUSED', pauseReason: 'human_takeover', pausedAt: new Date() },
      create: {
        agentId: body.agentId,
        locationId: agent.locationId,
        contactId: body.contactId,
        conversationId: body.conversationId || null,
        state: 'PAUSED',
        pauseReason: 'human_takeover',
        pausedAt: new Date(),
      },
    })

    const takeover = await db.liveTakeover.create({
      data: {
        agentId: body.agentId,
        contactId: body.contactId,
        conversationId: body.conversationId || null,
        locationId: agent.locationId,
        takenOverBy: access.session.user.id,
        reason: body.reason || null,
      },
    })

    await audit({
      workspaceId,
      actorId: access.session.user.id,
      action: 'conversation.takeover.start',
      targetType: 'contact',
      targetId: body.contactId,
      metadata: { agentId: body.agentId, takeoverId: takeover.id },
    })

    return NextResponse.json({ takeover })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
