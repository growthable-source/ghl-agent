import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'

type Params = { params: Promise<{ workspaceId: string; widgetId: string }> }

/**
 * DELETE /api/workspaces/:workspaceId/widgets/:widgetId/locations/connection
 *
 * Disconnect the widget's agency. Follows the repo's CRM-disconnect
 * precedent: blank the tokens rather than delete the row, so the synced
 * AgencyLocation rows — and every per-location on/off choice — survive.
 * Reconnecting the same agency upserts fresh tokens onto this row and
 * everything picks up where it left off. Admin+ only.
 *
 * Note the deliberate side effect of KEEPING the rows: embeds carrying
 * data-location-id keep honoring existing toggles while disconnected;
 * what stops is syncing (new sub-accounts won't appear) and management
 * refresh until reconnect.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const { workspaceId, widgetId } = await params
  const access = await requireWorkspaceRole(workspaceId, 'admin')
  if (access instanceof NextResponse) return access

  const result = await db.agencyConnection.updateMany({
    where: { widgetId, workspaceId, widget: { workspaceId } },
    data: { accessToken: '', refreshToken: '', tokenRefreshFailedAt: new Date() },
  }).catch(() => null)

  if (!result || result.count === 0) {
    return NextResponse.json({ error: 'No agency connection' }, { status: 404 })
  }
  return NextResponse.json({ disconnected: true })
}
