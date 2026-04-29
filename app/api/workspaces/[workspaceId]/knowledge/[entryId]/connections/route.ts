import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; entryId: string }> }

/**
 * PUT — replace the full set of agent connections for this entry.
 * Body: { agentIds: string[] }
 *
 * Idempotent: anything in the list that doesn't already exist is added,
 * anything that exists but isn't in the list is removed. Preserves
 * `attachedAt` timestamps for connections that survive the update so
 * "stacked on" history isn't lost.
 *
 * Why PUT not PATCH: this replaces the *entire* connection set. If you
 * pass an empty array, the entry is detached from every agent.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const { workspaceId, entryId } = await params
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

  // Verify entry belongs to this workspace.
  const entry = await db.knowledgeEntry.findFirst({
    where: { id: entryId, workspaceId },
    select: { id: true },
  })
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Verify every target agent is in this workspace.
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

  const current = await db.agentKnowledge.findMany({
    where: { knowledgeEntryId: entryId },
    select: { agentId: true },
  })
  const currentIds = new Set(current.map(c => c.agentId))
  const targetSet = new Set(targetIds)
  const toAdd = targetIds.filter(id => !currentIds.has(id))
  const toRemove = [...currentIds].filter(id => !targetSet.has(id))

  await db.$transaction(async tx => {
    if (toRemove.length > 0) {
      await tx.agentKnowledge.deleteMany({
        where: { knowledgeEntryId: entryId, agentId: { in: toRemove } },
      })
    }
    if (toAdd.length > 0) {
      await tx.agentKnowledge.createMany({
        data: toAdd.map(agentId => ({ agentId, knowledgeEntryId: entryId })),
        skipDuplicates: true,
      })
    }
  })

  return NextResponse.json({ ok: true, agentIds: targetIds })
}
