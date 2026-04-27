import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { encryptSecret } from '@/lib/secrets'
import { isMissingColumn, migrationPendingResponse } from '@/lib/migration-error'

type Params = { params: Promise<{ workspaceId: string; sourceId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, sourceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const data: Record<string, unknown> = {}
  if (typeof body.description === 'string') data.description = body.description.slice(0, 300)
  if (typeof body.isActive === 'boolean') data.isActive = body.isActive
  if (body.config && typeof body.config === 'object') data.config = body.config
  if (typeof body.secret === 'string') {
    if (body.secret === '') data.secretEnc = null
    else {
      try { data.secretEnc = encryptSecret(body.secret) }
      catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
    }
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
  }

  try {
    const source = await (db as any).workspaceDataSource.update({
      where: { id: sourceId },
      data,
    })
    const { secretEnc, ...safe } = source
    return NextResponse.json({ source: { ...safe, hasSecret: !!secretEnc } })
  } catch (err: any) {
    if (isMissingColumn(err)) return migrationPendingResponse('Data sources', 'manual_workspace_data_sources.sql')
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, sourceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  try {
    await (db as any).workspaceDataSource.delete({ where: { id: sourceId } })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    if (isMissingColumn(err)) return migrationPendingResponse('Data sources', 'manual_workspace_data_sources.sql')
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
