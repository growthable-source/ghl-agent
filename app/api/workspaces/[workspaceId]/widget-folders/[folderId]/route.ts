import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { isMissingColumn } from '@/lib/migration-error'

type Params = { params: Promise<{ workspaceId: string; folderId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, folderId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {}
  const data: Record<string, unknown> = {}
  if (typeof body.name === 'string') data.name = body.name.slice(0, 60)
  if (typeof body.color === 'string' || body.color === null) data.color = body.color
  if (typeof body.order === 'number') data.order = body.order
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

  try {
    const folder = await (db as any).widgetFolder.update({ where: { id: folderId }, data })
    return NextResponse.json({ folder })
  } catch (err: any) {
    if (isMissingColumn(err)) return NextResponse.json({ error: 'Folders not migrated yet' }, { status: 503 })
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/**
 * DELETE — removes the folder. Widgets inside drop back to "no folder"
 * (the FK is set null). They are *not* deleted alongside, even if the
 * UI hints that a folder is "empty" — operators expect their widgets
 * to survive a folder cleanup.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, folderId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  try {
    await (db as any).widgetFolder.delete({ where: { id: folderId } })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    if (isMissingColumn(err)) return NextResponse.json({ error: 'Folders not migrated yet' }, { status: 503 })
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
