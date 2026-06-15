import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; brandId: string }> }

const SLUG_RE = /^[a-z0-9-]{2,40}$/

/**
 * GET — full brand record + the widgets and collections currently
 * tagged to it (for the brand detail page).
 *
 * PATCH — edit name / slug / description / logo / colour.
 *
 * DELETE — drop the brand. Widgets and collections survive (FK is
 * SET NULL); they just become "untagged" until reassigned.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, brandId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const brand: any = await (db as any).brand.findFirst({
    where: { id: brandId, workspaceId },
    include: {
      widgets: { select: { id: true, name: true, type: true, isActive: true } },
      collections: {
        select: {
          id: true, name: true, icon: true, color: true,
          _count: { select: { entries: true, dataSources: true, attachments: true } },
        },
      },
    },
  }).catch(() => null)
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    brand: {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      description: brand.description,
      logoUrl: brand.logoUrl,
      primaryColor: brand.primaryColor,
      loginUrl: brand.loginUrl,
      createdAt: brand.createdAt.toISOString(),
      updatedAt: brand.updatedAt.toISOString(),
      widgets: brand.widgets,
      collections: brand.collections.map((c: any) => ({
        id: c.id, name: c.name, icon: c.icon, color: c.color,
        entryCount: c._count.entries,
        dataSourceCount: c._count.dataSources,
        agentCount: c._count.attachments,
      })),
    },
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, brandId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const existing = await (db as any).brand.findFirst({
    where: { id: brandId, workspaceId },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 80)
  if (typeof body.slug === 'string') {
    const slug = body.slug.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    if (!SLUG_RE.test(slug)) return NextResponse.json({ error: 'slug must be 2–40 lowercase letters, numbers, or dashes' }, { status: 400 })
    data.slug = slug
  }
  if (body.description !== undefined) {
    data.description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null
  }
  if (body.logoUrl !== undefined) {
    data.logoUrl = typeof body.logoUrl === 'string' && body.logoUrl.trim() ? body.logoUrl.trim() : null
  }
  if (body.primaryColor !== undefined) {
    data.primaryColor = typeof body.primaryColor === 'string' && body.primaryColor.trim() ? body.primaryColor.trim() : null
  }
  // loginUrl: must be an http(s) URL or null. Reject anything else so
  // the inbox "Open login" button can't point somewhere unsafe.
  if (body.loginUrl !== undefined) {
    const raw = typeof body.loginUrl === 'string' ? body.loginUrl.trim() : ''
    if (!raw) {
      data.loginUrl = null
    } else if (/^https?:\/\//i.test(raw)) {
      data.loginUrl = raw.slice(0, 500)
    } else {
      return NextResponse.json({ error: 'Login URL must start with http:// or https://' }, { status: 400 })
    }
  }
  // aiEnabled is a boolean toggle for human-only mode. Explicit boolean
  // check so other falsy values (null, "", undefined) don't accidentally
  // disable the agent for an entire brand.
  if (typeof body.aiEnabled === 'boolean') {
    data.aiEnabled = body.aiEnabled
  }
  // brandGroupId: explicit null detaches, string assigns, undefined
  // leaves untouched. Cross-workspace assignments are blocked — we
  // verify the target group lives in this workspace before saving.
  if (body.brandGroupId === null) {
    data.brandGroupId = null
  } else if (typeof body.brandGroupId === 'string' && body.brandGroupId.length > 0) {
    const target = await (db as any).brandGroup.findFirst({
      where: { id: body.brandGroupId, workspaceId },
      select: { id: true },
    }).catch(() => null)
    if (!target) {
      return NextResponse.json({ error: 'brandGroupId does not match a group in this workspace.' }, { status: 400 })
    }
    data.brandGroupId = body.brandGroupId
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  try {
    const brand = await (db as any).brand.update({ where: { id: brandId }, data })
    return NextResponse.json({ brand })
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'That slug is already used by another brand in this workspace.' }, { status: 409 })
    }
    throw err
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, brandId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const existing = await (db as any).brand.findFirst({
    where: { id: brandId, workspaceId },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await (db as any).brand.delete({ where: { id: brandId } })
  return NextResponse.json({ success: true })
}
