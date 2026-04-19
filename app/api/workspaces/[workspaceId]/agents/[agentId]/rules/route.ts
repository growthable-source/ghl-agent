import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/**
 * Detection rules — "IF the contact says X, THEN update field Y to value Z."
 * Companion to qualifying questions (which ASK for info); these listen
 * passively. Evaluated by the agent on every inbound message.
 */

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const rules = await (db as any).agentRule.findMany({
    where: { agentId },
    orderBy: { order: 'asc' },
  })
  return NextResponse.json({ rules })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()

  if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!body.conditionDescription?.trim()) return NextResponse.json({ error: 'conditionDescription required' }, { status: 400 })
  if (!body.targetFieldKey?.trim()) return NextResponse.json({ error: 'targetFieldKey required' }, { status: 400 })
  if (body.targetValue === undefined || body.targetValue === null) return NextResponse.json({ error: 'targetValue required' }, { status: 400 })

  const rule = await (db as any).agentRule.create({
    data: {
      agentId,
      name: body.name.trim(),
      conditionDescription: body.conditionDescription.trim(),
      examples: Array.isArray(body.examples) ? body.examples.filter((e: any) => typeof e === 'string' && e.trim()) : [],
      targetFieldKey: body.targetFieldKey.trim(),
      targetValue: String(body.targetValue),
      overwrite: body.overwrite ?? false,
      isActive: body.isActive ?? true,
      order: body.order ?? 0,
    },
  })
  return NextResponse.json({ rule }, { status: 201 })
}
