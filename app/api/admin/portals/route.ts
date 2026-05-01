import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

// POST /api/admin/portals — create a new customer portal scoped to a workspace.
// Admin-tier required (viewer is read-only).
export async function POST(req: NextRequest) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any = {}
  try { body = await req.json() } catch {}

  const workspaceId = String(body?.workspaceId ?? '').trim()
  const name = String(body?.name ?? '').trim()
  const slug = String(body?.slug ?? '').trim().toLowerCase()

  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return NextResponse.json({ error: 'slug must be lowercase letters, digits, dashes' }, { status: 400 })
  }
  if (slug.length > 60) {
    return NextResponse.json({ error: 'slug too long (max 60 chars)' }, { status: 400 })
  }

  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } })
  if (!ws) return NextResponse.json({ error: 'workspace not found' }, { status: 404 })

  // Slug is globally unique because the portal is reachable by slug from
  // a public URL (e.g. /portal/login?p=acme), and a collision would
  // route customers to the wrong brand surface.
  const existing = await db.portal.findUnique({ where: { slug }, select: { id: true } })
  if (existing) return NextResponse.json({ error: 'slug already taken' }, { status: 409 })

  const portal = await db.portal.create({
    data: { workspaceId, name, slug },
    select: { id: true, slug: true, name: true },
  })

  logAdminActionAfter({
    admin: session,
    action: 'create_portal',
    target: portal.id,
    meta: { workspaceId, slug, name },
  })

  return NextResponse.json({ portal })
}
