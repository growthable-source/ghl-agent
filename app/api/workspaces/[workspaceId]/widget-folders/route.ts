import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { isMissingColumn, migrationPendingResponse } from '@/lib/migration-error'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  try {
    const folders = await (db as any).widgetFolder.findMany({
      where: { workspaceId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    })
    return NextResponse.json({ folders })
  } catch (err: any) {
    if (isMissingColumn(err)) return NextResponse.json({ folders: [], notMigrated: true })
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {}
  const name = String(body.name || '').trim().slice(0, 60)
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  try {
    const folder = await (db as any).widgetFolder.create({
      data: {
        workspaceId,
        name,
        color: typeof body.color === 'string' ? body.color.slice(0, 20) : null,
        order: typeof body.order === 'number' ? body.order : 0,
      },
    })
    return NextResponse.json({ folder })
  } catch (err: any) {
    if (isMissingColumn(err)) return migrationPendingResponse('Widget folders', 'manual_widget_folders.sql')
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
