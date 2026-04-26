import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { generatePublicKey } from '@/lib/widget-auth'
import { canCreateWidget, widgetLimit } from '@/lib/plans'

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

  // Plan gating — graceful fallback if plan column / widget table doesn't exist
  try {
    const ws = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { plan: true },
    })
    if (ws) {
      const current = await db.chatWidget.count({ where: { workspaceId } })
      if (!canCreateWidget(ws.plan, current)) {
        return NextResponse.json({
          error: `Widget limit reached on the ${ws.plan} plan (${current}/${widgetLimit(ws.plan)}). Upgrade to create more.`,
          code: 'WIDGET_LIMIT',
        }, { status: 403 })
      }
    }
  } catch {
    // Pre-migration — allow
  }

  try {
    const type = body.type === 'click_to_call' ? 'click_to_call' : 'chat'
    const widget = await db.chatWidget.create({
      data: {
        workspaceId,
        name,
        type,
        publicKey: generatePublicKey(),
        defaultAgentId: body.defaultAgentId || null,
        // Click-to-call widgets default to having voice on
        voiceEnabled: type === 'click_to_call' ? true : false,
      },
    })
    return NextResponse.json({ widget })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to create widget' }, { status: 500 })
  }
}
