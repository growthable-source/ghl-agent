/**
 * Single-integration ops — currently just DELETE for disconnecting a
 * row from the dashboard.
 *
 * Auth: workspace membership only. We confirm the integration belongs
 * to a Location that belongs to this workspace before doing anything,
 * so a member of workspace A can't reach into workspace B's rows.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; integrationId: string }> }

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, integrationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // The Integration model doesn't expose Location as a Prisma relation
  // (no @relation back-reference), so we authorise via two queries:
  // pull the integration, then confirm its Location belongs to this
  // workspace before deleting. Two short SELECTs are cheap and keep
  // the auth boundary explicit.
  const integration = await db.integration.findUnique({
    where: { id: integrationId },
    select: { id: true, type: true, locationId: true },
  })
  if (!integration) {
    return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
  }
  const location = await db.location.findUnique({
    where: { id: integration.locationId },
    select: { workspaceId: true },
  })
  if (location?.workspaceId !== workspaceId) {
    return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
  }

  await db.integration.delete({ where: { id: integration.id } })
  return NextResponse.json({ ok: true, deleted: integration.id })
}
