import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  try {
    const channels = await db.notificationChannel.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ channels })
  } catch {
    return NextResponse.json({ channels: [], notMigrated: true })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (!body.type || !body.config) {
    return NextResponse.json({ error: 'type and config required' }, { status: 400 })
  }

  try {
    const channel = await db.notificationChannel.create({
      data: {
        workspaceId,
        type: body.type,
        config: body.config,
        events: body.events || [],
      },
    })
    return NextResponse.json({ channel })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
