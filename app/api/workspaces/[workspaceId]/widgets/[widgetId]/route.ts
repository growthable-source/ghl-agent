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
    'name', 'type', 'slug', 'embedMode', 'folderId',
    'primaryColor', 'logoUrl', 'title', 'subtitle', 'welcomeMessage',
    'position', 'buttonLabel', 'buttonShape', 'buttonSize', 'buttonIcon', 'buttonTextColor',
    'hostedPageHeadline', 'hostedPageSubtext',
    'requireEmail', 'askForNameEmail', 'voiceEnabled', 'voiceAgentId',
    'defaultAgentId', 'allowedDomains', 'isActive',
    'routingMode', 'routingTargetUserIds',
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

  // Columns that may not exist pre-migration. If the update touches any
  // of these and the DB is on the old schema, retry without them and
  // warn the operator. Click-to-call and routing/assignment landed in
  // separate migrations, so they're handled together as "newish columns
  // that we're tolerant about" — the legacy fields still save either way.
  const ctcKeys = ['type', 'slug', 'embedMode', 'buttonLabel', 'buttonShape', 'buttonSize', 'buttonIcon', 'buttonTextColor', 'hostedPageHeadline', 'hostedPageSubtext']
  const routingKeys = ['routingMode', 'routingTargetUserIds']
  const tolerantKeys = [...ctcKeys, ...routingKeys]
  const touchesTolerant = tolerantKeys.some(k => data[k] !== undefined)

  try {
    const widget = await db.chatWidget.update({ where: { id: widgetId }, data })
    return NextResponse.json({ widget })
  } catch (err: any) {
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'That slug is already taken' }, { status: 409 })
    }
    if (isMissingColumn(err) && touchesTolerant) {
      // Retry without the new columns so the legacy fields still save.
      const legacyData = { ...data }
      for (const k of tolerantKeys) delete legacyData[k]
      try {
        const widget = await db.chatWidget.update({ where: { id: widgetId }, data: legacyData })
        const skipped = tolerantKeys.filter(k => data[k] !== undefined)
        return NextResponse.json({
          widget,
          warning: `Some fields skipped (${skipped.join(', ')}) — run pending widget migrations to enable them.`,
          code: 'WIDGET_MIGRATION_PENDING',
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

export async function DELETE(req: NextRequest, { params }: Params) {
  const { workspaceId, widgetId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // Block delete when there's an active conversation behind it. The
  // dashboard surfaces the count so the operator can either take those
  // chats over and resolve them first, or pass `?force=1` to override
  // (which we still warn about — last-resort).
  const force = new URL(req.url).searchParams.get('force') === '1'
  const widget = await db.chatWidget.findFirst({
    where: { id: widgetId, workspaceId },
    include: {
      conversations: {
        where: { status: 'active' },
        select: { id: true },
      },
    },
  })
  if (!widget) return NextResponse.json({ error: 'Widget not found' }, { status: 404 })

  if (widget.conversations.length > 0 && !force) {
    return NextResponse.json({
      error: `This widget has ${widget.conversations.length} active conversation${widget.conversations.length === 1 ? '' : 's'}. End or take over the chat${widget.conversations.length === 1 ? '' : 's'} first, or pass force=1 to delete anyway.`,
      activeCount: widget.conversations.length,
      code: 'ACTIVE_CONVERSATIONS',
    }, { status: 409 })
  }

  await db.chatWidget.delete({ where: { id: widgetId } })
  return NextResponse.json({ success: true, forced: force && widget.conversations.length > 0 })
}
