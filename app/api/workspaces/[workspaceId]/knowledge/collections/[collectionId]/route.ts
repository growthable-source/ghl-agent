import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { sourceCollectionsReady, globalCollectionsReady, isMissingColumn } from '@/lib/knowledge/migration-state'

type Params = { params: Promise<{ workspaceId: string; collectionId: string }> }

/**
 * Single collection — full detail view used by the per-collection
 * editor page. Returns the collection metadata + every entry + every
 * data source + the list of currently-connected agents.
 *
 * PATCH — update name / description / icon / color / order.
 * DELETE — remove the collection. Cascades through entries +
 * (SET NULL) on data sources, since data sources can also live alone
 * in legacy hubs.
 */

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, collectionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const collection: any = await db.knowledgeCollection.findFirst({
    where: { id: collectionId, workspaceId },
    include: {
      entries: { orderBy: { createdAt: 'desc' } },
      dataSources: { orderBy: { createdAt: 'asc' } },
      attachments: {
        include: { agent: { select: { id: true, name: true } } },
      },
      ...(await sourceCollectionsReady() ? { _count: { select: { sources: true } } } : {}),
    },
  }).catch(() => null)
  if (!collection) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    collection: {
      id: collection.id,
      name: collection.name,
      description: collection.description,
      icon: collection.icon,
      color: collection.color,
      order: collection.order,
      kind: (collection as any).kind === 'help_center' ? 'help_center' : 'knowledge',
      sourceCount: collection._count?.sources ?? 0,
      createdAt: collection.createdAt.toISOString(),
      updatedAt: collection.updatedAt.toISOString(),
      entries: collection.entries.map((e: any) => ({
        id: e.id,
        title: e.title,
        content: e.content,
        source: e.source,
        sourceUrl: e.sourceUrl,
        tokenEstimate: e.tokenEstimate,
        status: e.status,
        createdAt: e.createdAt.toISOString(),
      })),
      dataSources: collection.dataSources.map((d: any) => ({
        id: d.id,
        name: d.name,
        kind: d.kind,
        description: d.description,
        isActive: d.isActive,
        // Never leak secretEnc; redact config to non-secret fields only
        config: redactConfig(d.config),
      })),
      connectedAgents: collection.attachments
        .filter((a: any) => a.agent)
        .map((a: any) => ({ id: a.agent.id, name: a.agent.name })),
    },
  })
}

function redactConfig(config: any): Record<string, any> {
  if (!config || typeof config !== 'object') return {}
  // The secretEnc column holds tokens; config holds non-secret hints
  // like sheet URL, base ID, table name, header keys (NOT values). The
  // existing data-source create endpoint already separates these, so
  // returning config as-is is safe — but defense in depth, drop any
  // key whose name screams secret.
  const out: Record<string, any> = {}
  for (const [k, v] of Object.entries(config)) {
    if (/secret|token|password|key$|api_?key/i.test(k)) continue
    out[k] = v
  }
  return out
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, collectionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 80)
  if (body.description !== undefined) {
    data.description = typeof body.description === 'string' && body.description.trim()
      ? body.description.trim()
      : null
  }
  if (body.icon !== undefined) {
    data.icon = typeof body.icon === 'string' && body.icon.trim() ? body.icon.trim() : null
  }
  if (body.color !== undefined) {
    data.color = typeof body.color === 'string' && body.color.trim() ? body.color.trim() : null
  }
  if (typeof body.order === 'number' && Number.isFinite(body.order)) data.order = Math.trunc(body.order)

  // kind: 'help_center' vs 'knowledge' — presentation grouping in the agent
  // knowledge picker. Anything but 'help_center' normalises to 'knowledge'.
  if (body.kind !== undefined) {
    data.kind = body.kind === 'help_center' ? 'help_center' : 'knowledge'
  }

  // brandId: explicit null clears the tag (back to "shared across
  // brands"); a non-empty string sets it after verifying it's a real
  // brand in this workspace.
  if (body.brandId !== undefined) {
    if (body.brandId === null || body.brandId === '') {
      data.brandId = null
    } else if (typeof body.brandId === 'string') {
      const brand = await (db as any).brand.findFirst({
        where: { id: body.brandId, workspaceId },
        select: { id: true },
      }).catch(() => null)
      if (!brand) return NextResponse.json({ error: 'brandId is not a brand in this workspace' }, { status: 400 })
      data.brandId = body.brandId
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const existing = await db.knowledgeCollection.findFirst({
    where: { id: collectionId, workspaceId },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let collection
  try {
    collection = await db.knowledgeCollection.update({
      where: { id: collectionId },
      data,
    })
  } catch (err) {
    // Pre-migration deploy window: the `kind` column may not exist yet, and
    // Prisma's UPDATE ... RETURNING references every model scalar — so even a
    // plain rename would P2022 until the migration lands. Fail soft rather
    // than 500; it self-heals the moment the migration runs.
    if (isMissingColumn(err)) {
      return NextResponse.json(
        { error: 'Knowledge is finishing an update — try again in a moment.', code: 'MIGRATION_PENDING' },
        { status: 503 },
      )
    }
    throw err
  }
  return NextResponse.json({ collection })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, collectionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const globalReady = await globalCollectionsReady()
  const existing = await db.knowledgeCollection.findFirst({
    where: { id: collectionId, workspaceId },
    select: globalReady ? { id: true, isGlobal: true } : { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // AgentCollection cascades on delete, and a collection-scoped agent
  // left with an empty set retrieves nothing at all (buildScopeFilter
  // returns AND FALSE). Deleting the shared corpus would therefore make
  // every provisioned agent in every workspace answer "I don't know",
  // permanently and silently.
  if ((existing as { isGlobal?: boolean }).isGlobal) {
    return NextResponse.json({
      error: 'This is the shared canonical corpus, read by agents in other workspaces. Un-flag isGlobal via SQL before deleting it.',
      code: 'GLOBAL_COLLECTION',
    }, { status: 409 })
  }

  await db.knowledgeCollection.delete({ where: { id: collectionId } })
  return NextResponse.json({ success: true })
}
