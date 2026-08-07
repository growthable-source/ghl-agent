import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { sourceCollectionsReady, globalCollectionsReady, isMissingColumn } from '@/lib/knowledge/migration-state'

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

  const countSelect: any = await sourceCollectionsReady()
    ? { entries: true, dataSources: true, sources: true }
    : { entries: true, dataSources: true }

  // The shared canonical corpus lives in another workspace, so the
  // picker has to admit it explicitly or the operator can never see
  // (or detach) what their agent is actually reading.
  const globalReady = await globalCollectionsReady()
  const availableWhere = globalReady
    ? { OR: [{ workspaceId }, { isGlobal: true }] }
    : { workspaceId }

  let attached: any[] = []
  let available: any[] = []
  try {
    [attached, available] = await Promise.all([
      db.agentCollection.findMany({
        where: { agentId },
        orderBy: { attachedAt: 'asc' },
        include: {
          collection: {
            include: { _count: { select: countSelect } },
          },
        },
      }),
      db.knowledgeCollection.findMany({
        where: availableWhere,
        // Corpus first — it's the one row the operator didn't create
        // and most needs to recognise.
        orderBy: globalReady
          ? [{ isGlobal: 'desc' as const }, { order: 'asc' as const }, { createdAt: 'asc' as const }]
          : [{ order: 'asc' as const }, { createdAt: 'asc' as const }],
        include: { _count: { select: countSelect } },
      }),
    ])
  } catch (err: any) {
    if (isMissingColumn(err)) {
      return NextResponse.json({ attached: [], available: [], notMigrated: true })
    }
    throw err
  }

  const attachedIds = new Set(attached.map(a => a.collectionId))
  return NextResponse.json({
    attached: attached.map(a => shape(a.collection, workspaceId)),
    available: available.map(c => ({
      ...shape(c, workspaceId),
      isAttached: attachedIds.has(c.id),
    })),
  })
}

function shape(c: any, workspaceId: string) {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    icon: c.icon,
    color: c.color,
    entryCount: c._count?.entries ?? 0,
    dataSourceCount: c._count?.dataSources ?? 0,
    sourceCount: c._count?.sources ?? 0,
    isGlobal: c.isGlobal === true,
    // Owned by someone else: the UI must render this as attach/detach
    // only, with no link into the knowledge editor (which 404s by design).
    isReadOnly: c.isGlobal === true && c.workspaceId !== workspaceId,
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
    // Attachable = mine, OR the shared canonical corpus. No
    // request-supplied value participates in the isGlobal arm, so this
    // names one super-admin-curated collection — not "any collection in
    // any workspace". isGlobal has no write path anywhere in the app
    // (every route builds an explicit allowlisted `data` object) and the
    // DB carries a trigger refusing the flip without a session GUC.
    //
    // Belt and braces: even if a row somehow landed in AgentCollection,
    // retrieval re-checks kc."isGlobal" = TRUE in its own SQL, so it
    // would still return nothing.
    const cols = await db.knowledgeCollection.findMany({
      where: (await globalCollectionsReady())
        ? { id: { in: targetIds }, OR: [{ workspaceId }, { isGlobal: true }] }
        : { id: { in: targetIds }, workspaceId },
      select: { id: true },
    })
    const valid = new Set(cols.map(c => c.id))
    for (const id of targetIds) {
      if (!valid.has(id)) {
        return NextResponse.json({ error: `Collection ${id} is not available to this workspace` }, { status: 400 })
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
