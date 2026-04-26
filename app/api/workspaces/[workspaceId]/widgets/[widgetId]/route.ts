import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

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

  try {
    const widget = await db.chatWidget.update({ where: { id: widgetId }, data })
    return NextResponse.json({ widget })
  } catch (err: any) {
    if (err.code === 'P2002') {
      return NextResponse.json({ error: 'That slug is already taken' }, { status: 409 })
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
