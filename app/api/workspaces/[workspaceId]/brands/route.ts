import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

const SLUG_RE = /^[a-z0-9-]{2,40}$/

function normalizeSlug(input: string): string {
  return input.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
}

/**
 * GET — every brand in the workspace, with widget + collection counts
 * (so the list view can show "3 widgets, 2 collections").
 *
 * POST — create a new brand. Body: { name, slug?, description?,
 * logoUrl?, primaryColor? }. Slug auto-generated from name when
 * omitted; uniqueness is per-workspace.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let rows: any[] = []
  try {
    rows = await (db as any).brand.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { widgets: true, collections: true } },
      },
    })
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ brands: [], notMigrated: true })
    }
    throw err
  }

  return NextResponse.json({
    brands: rows.map(b => ({
      id: b.id,
      name: b.name,
      slug: b.slug,
      description: b.description,
      logoUrl: b.logoUrl,
      primaryColor: b.primaryColor,
      widgetCount: b._count.widgets,
      collectionCount: b._count.collections,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
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

  // Slug: explicit value if provided, else derived from name. Validate
  // against the slug regex either way so we don't accept something
  // weird via "natural slug".
  const rawSlug = typeof body.slug === 'string' && body.slug.trim() ? body.slug : name
  const slug = normalizeSlug(rawSlug)
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json({ error: 'slug must be 2–40 lowercase letters, numbers, or dashes' }, { status: 400 })
  }

  try {
    const brand = await (db as any).brand.create({
      data: {
        workspaceId,
        name,
        slug,
        description: typeof body.description === 'string' ? body.description.trim() || null : null,
        logoUrl: typeof body.logoUrl === 'string' ? body.logoUrl.trim() || null : null,
        primaryColor: typeof body.primaryColor === 'string' ? body.primaryColor.trim() || null : null,
      },
    })
    return NextResponse.json({ brand }, { status: 201 })
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: `A brand with slug "${slug}" already exists in this workspace.` }, { status: 409 })
    }
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({
        error: 'Brand migration pending — run prisma/migrations/20260429180000_brands/migration.sql.',
        code: 'MIGRATION_PENDING',
      }, { status: 503 })
    }
    throw err
  }
}
