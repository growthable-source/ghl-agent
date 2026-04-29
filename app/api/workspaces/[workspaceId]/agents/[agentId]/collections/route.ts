import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/**
 * Per-agent view of attached collections. The agent settings page
 * pulls this to render its multi-select picker.
 *
 * GET — collections currently connected to this agent + every
 * collection in the workspace (so the picker can show what's
 * available to attach).
 *
 * PUT — replace the full set of collections this agent uses. Body:
 * { collectionIds: string[] }. Idempotent. Mirrors the
 * collection-side endpoint at /knowledge/collections/[id]/connections
 * but from the agent's perspective, which is the natural place to
 * "stack" collections onto a new agent.
 */

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  let attached: any[] = []
  let available: any[] = []
  try {
    [attached, available] = await Promise.all([
      db.agentCollection.findMany({
        where: { agentId },
        orderBy: { attachedAt: 'asc' },
        include: {
          collection: {
            include: { _count: { select: { entries: true, dataSources: true } } },
          },
        },
      }),
      db.knowledgeCollection.findMany({
        where: { workspaceId },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        include: { _count: { select: { entries: true, dataSources: true } } },
      }),
    ])
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ attached: [], available: [], notMigrated: true })
    }
    throw err
  }

  const attachedIds = new Set(attached.map(a => a.collectionId))
  return NextResponse.json({
    attached: attached.map(a => shape(a.collection)),
    available: available.map(c => ({
      ...shape(c),
      isAttached: attachedIds.has(c.id),
    })),
  })
}

function shape(c: any) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    icon: c.icon,
    color: c.color,
    entryCount: c._count?.entries ?? 0,
    dataSourceCount: c._count?.dataSources ?? 0,
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (!Array.isArray(body.collectionIds)) {
    return NextResponse.json({ error: 'collectionIds (string[]) required' }, { status: 400 })
  }
  const targetIds: string[] = Array.from(new Set(
    body.collectionIds.filter((s: unknown) => typeof s === 'string' && s.length > 0),
  )) as string[]

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  if (targetIds.length > 0) {
    const cols = await db.knowledgeCollection.findMany({
      where: { id: { in: targetIds }, workspaceId },
      select: { id: true },
    })
    const valid = new Set(cols.map(c => c.id))
    for (const id of targetIds) {
      if (!valid.has(id)) {
        return NextResponse.json({ error: `Collection ${id} is not in this workspace` }, { status: 400 })
      }
    }
  }

  const current = await db.agentCollection.findMany({
    where: { agentId },
    select: { collectionId: true },
  })
  const currentIds = new Set(current.map(c => c.collectionId))
  const targetSet = new Set(targetIds)
  const toAdd = targetIds.filter(id => !currentIds.has(id))
  const toRemove = [...currentIds].filter(id => !targetSet.has(id))

  await db.$transaction(async tx => {
    if (toRemove.length > 0) {
      await tx.agentCollection.deleteMany({
        where: { agentId, collectionId: { in: toRemove } },
      })
    }
    if (toAdd.length > 0) {
      await tx.agentCollection.createMany({
        data: toAdd.map(collectionId => ({ agentId, collectionId })),
        skipDuplicates: true,
      })
    }
  })

  return NextResponse.json({ ok: true, collectionIds: targetIds })
}
