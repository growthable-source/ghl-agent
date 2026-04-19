import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/**
 * Listening rules — categories the agent listens for without asking. Unlike
 * detection rules (which write a known value to a known field), listening
 * rules let the agent write free-text context into ContactMemory.categories
 * when something from the real conversation fits the category.
 */

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const rules = await (db as any).agentListeningRule.findMany({
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
  if (!body.description?.trim()) return NextResponse.json({ error: 'description required' }, { status: 400 })

  const rule = await (db as any).agentListeningRule.create({
    data: {
      agentId,
      name: body.name.trim(),
      description: body.description.trim(),
      examples: Array.isArray(body.examples) ? body.examples.filter((e: any) => typeof e === 'string' && e.trim()) : [],
      isActive: body.isActive ?? true,
      order: body.order ?? 0,
    },
  })
  return NextResponse.json({ rule }, { status: 201 })
}
