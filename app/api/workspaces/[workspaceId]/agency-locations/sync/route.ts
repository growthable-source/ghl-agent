import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'
import { syncAgencyLocations } from '@/lib/leadconnector-agency'

type Params = { params: Promise<{ workspaceId: string }> }

/** POST /api/workspaces/:id/agency-locations/sync — manual Refresh. Admin+. */
export async function POST(_req: Request, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceRole(workspaceId, 'admin')
  if (access instanceof NextResponse) return access

  const connection = await db.agencyConnection.findFirst({
    where: { workspaceId },
    select: { id: true },
  })
  if (!connection) return NextResponse.json({ error: 'No agency connection' }, { status: 404 })

  try {
    const result = await syncAgencyLocations(connection.id)
    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[AgencyLocations] manual sync failed:', err?.message)
    return NextResponse.json({ error: 'Sync failed — try reconnecting the agency' }, { status: 502 })
  }
}
