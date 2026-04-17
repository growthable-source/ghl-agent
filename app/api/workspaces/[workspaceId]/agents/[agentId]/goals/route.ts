import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/**
 * GET — list goals for an agent with per-goal win counts over 14/30 days.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  try {
    const goals = await db.agentGoal.findMany({
      where: { agentId },
      orderBy: { createdAt: 'asc' },
      include: {
        events: {
          where: { achievedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
          select: { achievedAt: true, contactId: true, turnsToAchieve: true },
        },
      },
    })

    const shaped = goals.map(g => {
      const last30 = g.events.length
      const last14 = g.events.filter(e => e.achievedAt > new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)).length
      const avgTurns = g.events.filter(e => e.turnsToAchieve).length > 0
        ? Math.round(g.events.reduce((s, e) => s + (e.turnsToAchieve || 0), 0) / g.events.filter(e => e.turnsToAchieve).length)
        : null
      return {
        id: g.id,
        name: g.name,
        goalType: g.goalType,
        value: g.value,
        isActive: g.isActive,
        maxTurns: g.maxTurns,
        createdAt: g.createdAt,
        winsLast14: last14,
        winsLast30: last30,
        avgTurnsToWin: avgTurns,
      }
    })

    return NextResponse.json({ goals: shaped })
  } catch {
    return NextResponse.json({ goals: [], notMigrated: true })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (!body.name || !body.goalType) {
    return NextResponse.json({ error: 'name and goalType required' }, { status: 400 })
  }

  try {
    const goal = await db.agentGoal.create({
      data: {
        agentId,
        name: body.name,
        goalType: body.goalType,
        value: body.value || null,
        maxTurns: body.maxTurns || null,
      },
    })
    return NextResponse.json({ goal })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
