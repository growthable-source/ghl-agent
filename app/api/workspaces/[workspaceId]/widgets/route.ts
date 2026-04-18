import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { generatePublicKey } from '@/lib/widget-auth'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  try {
    const widgets = await db.chatWidget.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { conversations: true, visitors: true } },
      },
    })
    return NextResponse.json({ widgets })
  } catch {
    return NextResponse.json({ widgets: [], notMigrated: true })
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
  const name = (body.name || '').trim() || 'New Widget'

  try {
    const widget = await db.chatWidget.create({
      data: {
        workspaceId,
        name,
        publicKey: generatePublicKey(),
        defaultAgentId: body.defaultAgentId || null,
      },
    })
    return NextResponse.json({ widget })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to create widget' }, { status: 500 })
  }
}
