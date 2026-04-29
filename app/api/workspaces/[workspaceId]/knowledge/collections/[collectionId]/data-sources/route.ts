import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { encryptSecret } from '@/lib/secrets'
import { isMissingColumn, migrationPendingResponse } from '@/lib/migration-error'

type Params = { params: Promise<{ workspaceId: string; collectionId: string }> }

const VALID_KINDS = new Set(['google_sheet', 'airtable', 'rest_get'])
const NAME_RE = /^[a-z0-9_-]{2,40}$/

/**
 * POST — create a data source inside this collection. Mirrors the
 * existing /workspaces/[id]/data-sources endpoint but scoped to a
 * collection. The collection_id is the new mandatory home for data
 * sources; the legacy endpoint still works (it routes to the
 * workspace's default collection) but new product surface should
 * use this one so operators always think in collections.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, collectionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const collection = await db.knowledgeCollection.findFirst({
    where: { id: collectionId, workspaceId },
    select: { id: true },
  })
  if (!collection) return NextResponse.json({ error: 'Collection not found' }, { status: 404 })

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const name = String(body.name || '').toLowerCase().trim()
  const kind = String(body.kind || '')
  if (!NAME_RE.test(name)) {
    return NextResponse.json({ error: 'Name must be 2–40 chars, lowercase letters/numbers/dashes/underscores' }, { status: 400 })
  }
  if (!VALID_KINDS.has(kind)) {
    return NextResponse.json({ error: 'kind must be google_sheet, airtable, or rest_get' }, { status: 400 })
  }

  const config = (body.config && typeof body.config === 'object') ? body.config : {}
  const description = typeof body.description === 'string' ? body.description.slice(0, 300) : null

  let secretEnc: string | null = null
  if (body.secret && typeof body.secret === 'string') {
    try { secretEnc = encryptSecret(body.secret) }
    catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
  }

  try {
    const source = await (db as any).workspaceDataSource.create({
      data: { workspaceId, collectionId, name, kind, description, config, secretEnc, isActive: true },
    })
    const { secretEnc: _drop, ...safe } = source
    return NextResponse.json({ source: { ...safe, hasSecret: !!source.secretEnc } })
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: `A data source named "${name}" already exists in this workspace.` }, { status: 409 })
    }
    if (isMissingColumn(err)) return migrationPendingResponse('Data sources', 'manual_workspace_data_sources.sql')
    return NextResponse.json({ error: err.message || 'Failed to create data source' }, { status: 500 })
  }
}
