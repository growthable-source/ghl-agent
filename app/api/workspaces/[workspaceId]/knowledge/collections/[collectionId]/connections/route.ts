import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; collectionId: string }> }

/**
 * PUT — replace the full set of agents connected to this collection.
 * Body: { agentIds: string[] }
 *
 * This is the workspace-knowledge-page perspective. The mirror
 * endpoint at /workspaces/:wid/agents/:aid/collections lets you do
 * the same operation from the agent's perspective (set the full
 * list of collections an agent uses). Either side is fine — they
 * write to the same AgentCollection junction.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const { workspaceId, collectionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (!Array.isArray(body.agentIds)) {
    return NextResponse.json({ error: 'agentIds (string[]) required' }, { status: 400 })
  }
  const targetIds: string[] = Array.from(new Set(
    body.agentIds.filter((s: unknown) => typeof s === 'string' && s.length > 0),
  )) as string[]

  const collection = await db.knowledgeCollection.findFirst({
    where: { id: collectionId, workspaceId },
    select: { id: true },
  })
  if (!collection) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (targetIds.length > 0) {
    const agents = await db.agent.findMany({
      where: { id: { in: targetIds }, workspaceId },
      select: { id: true },
    })
    const valid = new Set(agents.map(a => a.id))
    for (const id of targetIds) {
      if (!valid.has(id)) {
        return NextResponse.json({ error: `Agent ${id} is not in this workspace` }, { status: 400 })
      }
    }
  }

  const current = await db.agentCollection.findMany({
    where: { collectionId },
    select: { agentId: true },
  })
  const currentIds = new Set(current.map(c => c.agentId))
  const targetSet = new Set(targetIds)
  const toAdd = targetIds.filter(id => !currentIds.has(id))
  const toRemove = [...currentIds].filter(id => !targetSet.has(id))

  await db.$transaction(async tx => {
    if (toRemove.length > 0) {
      await tx.agentCollection.deleteMany({
        where: { collectionId, agentId: { in: toRemove } },
      })
    }
    if (toAdd.length > 0) {
      await tx.agentCollection.createMany({
        data: toAdd.map(agentId => ({ agentId, collectionId })),
        skipDuplicates: true,
      })
    }
  })

  return NextResponse.json({ ok: true, agentIds: targetIds })
}
