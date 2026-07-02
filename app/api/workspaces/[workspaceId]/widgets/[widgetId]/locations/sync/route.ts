import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'
import { syncAgencyLocations } from '@/lib/leadconnector-agency'

type Params = { params: Promise<{ workspaceId: string; widgetId: string }> }

/** POST /api/workspaces/:workspaceId/widgets/:widgetId/locations/sync — manual Refresh. Admin+. */
export async function POST(_req: Request, { params }: Params) {
  const { workspaceId, widgetId } = await params
  const access = await requireWorkspaceRole(workspaceId, 'admin')
  if (access instanceof NextResponse) return access

  const connection = await db.agencyConnection.findFirst({
    where: { widgetId, workspaceId, widget: { workspaceId } },
    select: { id: true },
  }).catch(() => null)
  if (!connection) return NextResponse.json({ error: 'No agency connection' }, { status: 404 })

  try {
    const result = await syncAgencyLocations(connection.id)
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[AgencyLocations] manual sync failed:', err?.message)
    return NextResponse.json({ error: 'Sync failed — try reconnecting the agency' }, { status: 502 })
  }
}
