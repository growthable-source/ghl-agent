import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }
const PRIORITIES = ['urgent', 'high', 'normal', 'low', 'default']

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const policies = await db.slaPolicy.findMany({ where: { workspaceId } })
  return NextResponse.json({ policies })
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  if (access.role !== 'owner' && access.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { priority, firstResponseMins, resolutionMins, enabled } = await req.json()
  if (!PRIORITIES.includes(priority)) {
    return NextResponse.json({ error: 'invalid priority' }, { status: 422 })
  }
  const policy = await db.slaPolicy.upsert({
    where: { workspaceId_priority: { workspaceId, priority } },
    create: {
      workspaceId,
      priority,
      firstResponseMins: firstResponseMins ?? null,
      resolutionMins: resolutionMins ?? null,
      enabled: enabled ?? true,
    },
    update: {
      firstResponseMins: firstResponseMins ?? null,
      resolutionMins: resolutionMins ?? null,
      enabled: enabled ?? true,
    },
  })
  return NextResponse.json({ policy })
}
