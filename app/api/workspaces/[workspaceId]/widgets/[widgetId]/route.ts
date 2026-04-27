import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { isMissingColumn } from '@/lib/migration-error'

type Params = { params: Promise<{ workspaceId: string; widgetId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, widgetId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const widget = await db.chatWidget.findFirst({
    where: { id: widgetId, workspaceId },
    include: {
      _count: { select: { conversations: true, visitors: true } },
    },
  })
  if (!widget) return NextResponse.json({ error: 'Widget not found' }, { status: 404 })
  return NextResponse.json({ widget })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, widgetId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const allowed = [
    'name', 'type', 'slug', 'embedMode',
    'primaryColor', 'logoUrl', 'title', 'subtitle', 'welcomeMessage',
    'position', 'buttonLabel', 'buttonShape', 'buttonSize', 'buttonIcon', 'buttonTextColor',
    'hostedPageHeadline', 'hostedPageSubtext',
    'requireEmail', 'askForNameEmail', 'voiceEnabled', 'voiceAgentId',
    'defaultAgentId', 'allowedDomains', 'isActive',
  ]
  const data: Record<string, unknown> = {}
  for (const key of allowed) {
    if (body[key] !== undefined) data[key] = body[key]
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
  }

  // Slug normalization: lowercase, alphanumeric + dash, empty string -> null
  if (typeof data.slug === 'string') {
    const cleaned = data.slug.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
    data.slug = cleaned || null
  }

  // Click-to-call columns that may not exist pre-migration. If the
  // update touches any of these and the DB is on the old schema, retry
  // with just the legacy fields and warn the operator.
  const ctcKeys = ['type', 'slug', 'embedMode', 'buttonLabel', 'buttonShape', 'buttonSize', 'buttonIcon', 'buttonTextColor', 'hostedPageHeadline', 'hostedPageSubtext']
  const touchesCtc = ctcKeys.some(k => data[k] !== undefined)

  try {
    const widget = await db.chatWidget.update({ where: { id: widgetId }, data })
    return NextResponse.json({ widget })
  } catch (err: any) {
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'That slug is already taken' }, { status: 409 })
    }
    if (isMissingColumn(err) && touchesCtc) {
      // Retry without the click-to-call fields so the legacy fields still save.
      const legacyData = { ...data }
      for (const k of ctcKeys) delete legacyData[k]
      try {
        const widget = await db.chatWidget.update({ where: { id: widgetId }, data: legacyData })
        return NextResponse.json({
          widget,
          warning: 'Click-to-call fields skipped — run prisma/migrations-legacy/manual_widget_click_to_call.sql to enable them.',
          code: 'CLICK_TO_CALL_MIGRATION_PENDING',
        })
      } catch (err2: any) {
        return NextResponse.json({ error: err2.message || 'Failed to update widget' }, { status: 500 })
      }
    }
    if (isMissingColumn(err)) {
      return NextResponse.json({
        error: 'Widget table is missing columns — check pending migrations.',
        code: 'MIGRATION_PENDING',
      }, { status: 503 })
    }
    return NextResponse.json({ error: err.message || 'Failed to update widget' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, widgetId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  await db.chatWidget.delete({ where: { id: widgetId } })
  return NextResponse.json({ success: true })
}
