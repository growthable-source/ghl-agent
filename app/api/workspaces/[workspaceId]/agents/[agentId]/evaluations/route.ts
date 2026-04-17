import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  try {
    const evaluations = await db.agentEvaluation.findMany({
      where: { agentId },
      include: {
        runs: { orderBy: { runAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ evaluations })
  } catch {
    return NextResponse.json({ evaluations: [], notMigrated: true })
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
  if (!body.name || !body.scenario) {
    return NextResponse.json({ error: 'Name and scenario required' }, { status: 400 })
  }

  try {
    const evaluation = await db.agentEvaluation.create({
      data: {
        agentId,
        name: body.name,
        scenario: body.scenario,
        expectedContains: body.expectedContains || [],
        expectedNotContains: body.expectedNotContains || [],
        expectedTool: body.expectedTool || null,
      },
    })
    return NextResponse.json({ evaluation })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to create' }, { status: 500 })
  }
}
