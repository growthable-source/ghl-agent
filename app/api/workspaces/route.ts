import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * GET /api/workspaces — list workspaces for the current user
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const memberships = await db.workspaceMember.findMany({
    where: { userId: session.user.id },
    include: {
      workspace: {
        include: {
          _count: { select: { agents: true, locations: true, members: true } },
          locations: { select: { id: true, crmProvider: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const workspaces = memberships.map(m => ({
    ...m.workspace,
    role: m.role,
  }))

  return NextResponse.json({ workspaces })
}

/**
 * POST /api/workspaces — create a new workspace
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const name = (body.name || '').trim()
  const icon = (body.icon || '🚀').trim()
  const domain = (body.domain || '').trim() || null

  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  // Generate a URL-safe slug
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  const uniqueSuffix = Math.random().toString(36).slice(2, 8)
  const slug = `${baseSlug}-${uniqueSuffix}`

  const workspace = await db.workspace.create({
    data: {
      name,
      slug,
      icon,
      domain,
      members: {
        create: {
          userId: session.user.id,
          role: 'owner',
        },
      },
    },
  })

  return NextResponse.json({ workspace, workspaceId: workspace.id }, { status: 201 })
}
