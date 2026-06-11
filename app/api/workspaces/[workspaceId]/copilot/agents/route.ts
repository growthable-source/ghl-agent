/**
 * Co-Pilot agents — the first-class entities a workspace creates.
 *   GET  — list (with recording counts + processing state)
 *   POST — create { name, persona?, steps[], timeboxMinutes?, knowledgeDomainIds[] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agents = await db.copilotAgent.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    include: { recordings: { select: { status: true } } },
  })

  return NextResponse.json({
    agents: agents.map(a => ({
      id: a.id,
      name: a.name,
      persona: a.persona,
      steps: Array.isArray(a.steps) ? a.steps : [],
      timeboxMinutes: a.timeboxMinutes,
      knowledgeDomainIds: a.knowledgeDomainIds,
      hasPlaybook: !!a.playbook,
      recordingCount: a.recordings.length,
      recordingsProcessing: a.recordings.filter(r => r.status === 'queued' || r.status === 'processing').length,
    })),
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    persona?: string
    steps?: unknown[]
    timeboxMinutes?: number
    knowledgeDomainIds?: unknown[]
  }
  const name = (body.name ?? '').trim().slice(0, 120)
  if (!name) return NextResponse.json({ error: 'A name is required.' }, { status: 400 })

  const steps = (Array.isArray(body.steps) ? body.steps : [])
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map(s => s.trim().slice(0, 500))
    .slice(0, 40)
  const knowledgeDomainIds = (Array.isArray(body.knowledgeDomainIds) ? body.knowledgeDomainIds : [])
    .filter((d): d is string => typeof d === 'string')
    .slice(0, 50)

  const agent = await db.copilotAgent.create({
    data: {
      workspaceId,
      name,
      persona: typeof body.persona === 'string' ? body.persona.slice(0, 4000) : null,
      steps,
      knowledgeDomainIds,
      timeboxMinutes: Math.max(5, Math.min(120, Math.round(Number(body.timeboxMinutes) || 30))),
    },
  })
  return NextResponse.json({ agentId: agent.id })
}
