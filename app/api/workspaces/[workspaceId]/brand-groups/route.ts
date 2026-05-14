import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:id/brand-groups
 *
 * Returns every brand-priority group in this workspace, ordered by
 * priority (lower number = higher priority), then name. Includes
 * brand counts so the UI can show "3 brands" next to each group.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  try {
    const groups = await (db as any).brandGroup.findMany({
      where: { workspaceId },
      orderBy: [{ priority: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { brands: true } },
      },
    })
    return NextResponse.json({
      groups: groups.map((g: any) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        priority: g.priority,
        color: g.color,
        brandCount: g._count.brands,
        createdAt: g.createdAt.toISOString(),
        updatedAt: g.updatedAt.toISOString(),
      })),
    })
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ groups: [], notMigrated: true })
    }
    throw err
  }
}

/**
 * POST /api/workspaces/:id/brand-groups
 * Body: { name, description?, priority?, color? }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {}
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const data: any = {
    workspaceId,
    name,
    description: typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null,
    priority: Number.isFinite(body.priority) ? Math.max(0, Math.min(9999, Math.round(body.priority))) : 100,
    color: typeof body.color === 'string' && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : null,
  }

  try {
    const group = await (db as any).brandGroup.create({ data })
    return NextResponse.json({ group })
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'A group with that name already exists.' }, { status: 409 })
    }
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({
        error: 'Brand groups not yet migrated — run prisma/migrations-legacy/manual_brand_groups.sql',
        code: 'MIGRATION_PENDING',
      }, { status: 503 })
    }
    throw err
  }
}
