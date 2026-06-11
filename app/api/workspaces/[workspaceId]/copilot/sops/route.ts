/**
 * Workspace SOPs for Co-Pilot 'sop' mode.
 *   GET    — list
 *   POST   — create { title, goal, timeboxMinutes, steps: string[] }
 *   DELETE — ?id=<sopId>
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const sops = await db.copilotSop.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' } })
  return NextResponse.json({
    sops: sops.map(s => ({
      id: s.id,
      title: s.title,
      goal: s.goal,
      timeboxMinutes: s.timeboxMinutes,
      steps: Array.isArray(s.steps) ? s.steps : [],
    })),
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = (await req.json().catch(() => ({}))) as {
    title?: string
    goal?: string
    timeboxMinutes?: number
    steps?: unknown[]
  }
  const title = (body.title ?? '').trim().slice(0, 120)
  const goal = (body.goal ?? '').trim().slice(0, 1000)
  const steps = (Array.isArray(body.steps) ? body.steps : [])
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map(s => s.trim().slice(0, 500))
    .slice(0, 30)
  if (!title || steps.length === 0) {
    return NextResponse.json({ error: 'A title and at least one step are required.' }, { status: 400 })
  }
  const timeboxMinutes = Math.max(5, Math.min(120, Math.round(Number(body.timeboxMinutes) || 20)))

  const sop = await db.copilotSop.create({
    data: { workspaceId, title, goal: goal || title, timeboxMinutes, steps },
  })
  return NextResponse.json({ sop: { id: sop.id, title: sop.title, goal: sop.goal, timeboxMinutes: sop.timeboxMinutes, steps } })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await db.copilotSop.deleteMany({ where: { id, workspaceId } })
  return NextResponse.json({ ok: true })
}
