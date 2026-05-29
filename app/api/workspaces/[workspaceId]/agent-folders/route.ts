import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { isMissingColumn, migrationPendingResponse } from '@/lib/migration-error'

/**
 * Agent folder endpoints. Lifted directly from the WidgetFolder pattern
 * (see ../widget-folders/route.ts) — same shape, same migration-pending
 * fallback so the agents page degrades cleanly when the schema is mid-
 * deploy on a fresh tenant.
 *
 *   GET   list folders for the workspace, ordered by .order then createdAt
 *   POST  create a new folder { name, color?, order? }
 *
 * Per-folder PATCH/DELETE lives in ./[folderId]/route.ts.
 */

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  try {
    const folders = await db.agentFolder.findMany({
      where: { workspaceId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    })
    return NextResponse.json({ folders })
  } catch (err: any) {
    // Schema not migrated yet (fresh tenant on a build that ran before
    // the AgentFolder table existed). Mirror WidgetFolder's behaviour
    // and return an empty list with a flag so the UI hides the folders
    // affordance instead of error-toasting.
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
    const folder = await db.agentFolder.create({
      data: {
        workspaceId,
        name,
        color: typeof body.color === 'string' ? body.color.slice(0, 20) : null,
        order: typeof body.order === 'number' ? body.order : 0,
      },
    })
    return NextResponse.json({ folder })
  } catch (err: any) {
    if (isMissingColumn(err)) {
      return migrationPendingResponse('Agent folders', '20260529040000_agent_folders/migration.sql')
    }
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
