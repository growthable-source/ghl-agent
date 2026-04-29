import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

/**
 * GET /api/workspaces/:id/members — list workspace members
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // Explicit select — pending migrations on WorkspaceMember (e.g.
  // digestOptIn) would otherwise crash this listing.
  let members: any[]
  try {
    members = await db.workspaceMember.findMany({
      where: { workspaceId },
      select: {
        id: true,
        role: true,
        createdAt: true,
        isAvailable: true,
        availabilityChangedAt: true,
        user: { select: { id: true, name: true, email: true, image: true } },
      },
      orderBy: { createdAt: 'asc' },
    })
  } catch (err: any) {
    // Routing-assignment migration may not be applied yet — fall back to
    // the bare select so the members page keeps working.
    if (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')) {
      members = await db.workspaceMember.findMany({
        where: { workspaceId },
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true, image: true } },
        },
        orderBy: { createdAt: 'asc' },
      })
      members = members.map(m => ({ ...m, isAvailable: true, availabilityChangedAt: null }))
    } else {
      throw err
    }
  }

  return NextResponse.json({ members })
}

/**
 * PATCH /api/workspaces/:id/members — update workspace details (name, icon)
 * Only owners and admins can update.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  if (access.role !== 'owner' && access.role !== 'admin') {
    return NextResponse.json({ error: 'Only owners and admins can update workspace settings' }, { status: 403 })
  }

  const body = await req.json()
  const data: Record<string, unknown> = {}

  if (body.name && typeof body.name === 'string') {
    data.name = body.name.trim().slice(0, 100)
  }
  if (body.icon && typeof body.icon === 'string') {
    data.icon = body.icon.trim().slice(0, 4)
  }
  // logoUrl: explicit null clears (fall back to emoji), non-empty string
  // sets, empty string also clears. Undefined leaves it alone. Capped at
  // 2000 chars so someone can't jam a massive data: URL in here; https://
  // validation is soft — we only require the protocol, not reachability,
  // since the image element handles 404s naturally.
  if (Object.prototype.hasOwnProperty.call(body, 'logoUrl')) {
    if (body.logoUrl === null || body.logoUrl === '') {
      data.logoUrl = null
    } else if (typeof body.logoUrl === 'string') {
      const trimmed = body.logoUrl.trim().slice(0, 2000)
      if (!/^https?:\/\//i.test(trimmed)) {
        return NextResponse.json({
          error: 'logoUrl must be an http(s) URL. Upload a file via /logo/upload instead if you meant to attach one.',
        }, { status: 400 })
      }
      data.logoUrl = trimmed
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const workspace = await db.workspace.update({
    where: { id: workspaceId },
    data,
  })

  return NextResponse.json({ workspace })
}
