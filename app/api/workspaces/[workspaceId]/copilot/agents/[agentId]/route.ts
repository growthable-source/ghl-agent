/**
 * Single Co-Pilot agent.
 *   GET    — full detail incl. persona, steps, playbook, recordings
 *   PATCH  — update editable fields (name, persona, steps, timebox,
 *            knowledgeDomainIds, playbook). Editing the playbook by
 *            hand is allowed — it's just text.
 *   DELETE — remove the agent (recordings cascade)
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.copilotAgent.findFirst({
    where: { id: agentId, workspaceId },
    include: { recordings: { orderBy: { createdAt: 'desc' } } },
  })
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    agent: {
      id: agent.id,
      name: agent.name,
      persona: agent.persona,
      steps: Array.isArray(agent.steps) ? agent.steps : [],
      timeboxMinutes: agent.timeboxMinutes,
      knowledgeDomainIds: agent.knowledgeDomainIds,
      playbook: agent.playbook,
      recordings: agent.recordings.map(r => ({
        id: r.id,
        originalFilename: r.originalFilename,
        status: r.status,
        error: r.error,
        hasWalkthrough: !!r.walkthrough && !/AUDIO ONLY/i.test(r.walkthrough),
        createdAt: r.createdAt.toISOString(),
      })),
    },
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const owned = await db.copilotAgent.findFirst({ where: { id: agentId, workspaceId }, select: { id: true } })
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const data: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 120)
  if (typeof body.persona === 'string') data.persona = body.persona.slice(0, 4000)
  if (typeof body.playbook === 'string') data.playbook = body.playbook.slice(0, 12_000)
  if (typeof body.timeboxMinutes === 'number') data.timeboxMinutes = Math.max(5, Math.min(120, Math.round(body.timeboxMinutes)))
  if (Array.isArray(body.steps)) {
    data.steps = body.steps
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map(s => s.trim().slice(0, 500))
      .slice(0, 40)
  }
  if (Array.isArray(body.knowledgeDomainIds)) {
    data.knowledgeDomainIds = body.knowledgeDomainIds.filter((d): d is string => typeof d === 'string').slice(0, 50)
  }

  await db.copilotAgent.update({ where: { id: agentId }, data })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  await db.copilotAgent.deleteMany({ where: { id: agentId, workspaceId } })
  return NextResponse.json({ ok: true })
}
