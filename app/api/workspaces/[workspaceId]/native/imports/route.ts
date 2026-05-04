import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { processNativeImport, type ColumnMapping, type ImportRow } from '@/lib/crm/native/imports'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const imports = await db.nativeContactImport.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { list: { select: { id: true, name: true } } },
  })
  return NextResponse.json({ imports })
}

/**
 * POST — start a synchronous import.
 * Body: { filename, rows: [{rowNumber, data: {header: value}}], columnMapping, listId? }
 *
 * The CSV parsing happens in the upload UI (client-side) so we can stream
 * row count + give immediate column-mapping feedback. Server takes the
 * pre-parsed rows and runs dedupe / suppression / insert.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = await req.json()
  if (!body.filename || !Array.isArray(body.rows) || !body.columnMapping) {
    return NextResponse.json({ error: 'filename, rows, columnMapping required' }, { status: 400 })
  }
  const summary = await processNativeImport({
    workspaceId,
    filename: String(body.filename),
    rows: body.rows as ImportRow[],
    columnMapping: body.columnMapping as ColumnMapping,
    listId: body.listId ?? null,
    createdBy: access.session.user.id,
  })
  return NextResponse.json({ summary })
}
