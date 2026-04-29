import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * Workspace knowledge collections — the top-level list view.
 *
 * GET — every collection in the workspace, with item counts (entries,
 * data sources) and the count of agents currently connected.
 * POST — create a new collection. Body: { name, description?, icon?, color? }
 */

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let rows: any[] = []
  try {
    rows = await db.knowledgeCollection.findMany({
      where: { workspaceId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: {
        _count: { select: { entries: true, dataSources: true, attachments: true } },
      },
    })
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ collections: [], notMigrated: true })
    }
    throw err
  }

  return NextResponse.json({
    collections: rows.map(c => ({
      id: c.id,
      name: c.name,
      description: c.description,
      icon: c.icon,
      color: c.color,
      order: c.order,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      entryCount: c._count.entries,
      dataSourceCount: c._count.dataSources,
      agentCount: c._count.attachments,
    })),
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (name.length > 80) return NextResponse.json({ error: 'name too long (max 80)' }, { status: 400 })

  // Optional brandId — verify it belongs to this workspace before
  // setting it. Workspaces without brands just leave it null.
  let brandId: string | null = null
  if (body.brandId !== undefined && body.brandId !== null && body.brandId !== '') {
    if (typeof body.brandId !== 'string') {
      return NextResponse.json({ error: 'brandId must be a string' }, { status: 400 })
    }
    const brand = await (db as any).brand.findFirst({
      where: { id: body.brandId, workspaceId },
      select: { id: true },
    }).catch(() => null)
    if (!brand) return NextResponse.json({ error: 'brandId is not a brand in this workspace' }, { status: 400 })
    brandId = body.brandId
  }

  try {
    const collection = await db.knowledgeCollection.create({
      data: {
        workspaceId,
        name,
        description: typeof body.description === 'string' ? body.description.trim() || null : null,
        icon: typeof body.icon === 'string' ? body.icon.trim() || null : null,
        color: typeof body.color === 'string' ? body.color.trim() || null : null,
        brandId,
      } as any,
    })
    return NextResponse.json({ collection }, { status: 201 })
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({
        error: 'Collections migration pending — run prisma/migrations/20260429160000_knowledge_collections/migration.sql.',
        code: 'MIGRATION_PENDING',
      }, { status: 503 })
    }
    throw err
  }
}
