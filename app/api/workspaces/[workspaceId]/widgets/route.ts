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

  const type = body.type === 'click_to_call' ? 'click_to_call' : 'chat'
  const baseData = {
    workspaceId,
    name,
    publicKey: generatePublicKey(),
    defaultAgentId: body.defaultAgentId || null,
    voiceEnabled: type === 'click_to_call',
  }

  try {
    const widget = await db.chatWidget.create({
      data: { ...baseData, type },
    })
    return NextResponse.json({ widget })
  } catch (err: any) {
    // Pending click-to-call migration: ChatWidget.type (and friends) don't
    // exist yet. Fall back to creating a chat-only widget without the new
    // fields so the UI can still ship widgets, but tell the operator what
    // needs to happen for click-to-call to work.
    const isMissingColumn = err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')
    if (isMissingColumn) {
      if (type === 'click_to_call') {
        return NextResponse.json({
          error: "Click-to-call needs a database migration first — run prisma/migrations-legacy/manual_widget_click_to_call.sql in Supabase, then try again.",
          code: 'MIGRATION_PENDING',
        }, { status: 503 })
      }
      // Plain chat widget: try again without the new columns
      try {
        const widget = await db.chatWidget.create({ data: baseData })
        return NextResponse.json({ widget })
      } catch (err2: any) {
        return NextResponse.json({ error: err2.message || 'Failed to create widget' }, { status: 500 })
      }
    }
    return NextResponse.json({ error: err.message || 'Failed to create widget' }, { status: 500 })
  }
}
