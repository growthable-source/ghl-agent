import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500)

  try {
    const logs = await db.auditLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    // Collect unique actor IDs and resolve to names
    const actorIds = [...new Set(logs.map(l => l.actorId))]
    const users = await db.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, name: true, email: true },
    })
    const userMap = new Map(users.map(u => [u.id, u]))

    const shaped = logs.map(l => ({
      ...l,
      actor: userMap.get(l.actorId) || null,
    }))

    return NextResponse.json({ logs: shaped })
  } catch {
    return NextResponse.json({ logs: [], notMigrated: true })
  }
}
