import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getValidAccessToken } from '@/lib/token-store'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

/**
 * List calendars from the LeadConnector location this agent (or workspace)
 * is bound to. The location resolution used to be `findFirst({ workspaceId })`
 * — but on workspaces with both a `native:<wsId>` placeholder AND a real
 * LeadConnector location, Prisma frequently returned the native placeholder
 * first. That has no GHL token → getValidAccessToken returned null →
 * front-end saw "0 calendars" with no clear reason. Ryan's screenshot from
 * 2026-05-29 reproduced this.
 *
 * Resolution order now:
 *   1. ?agentId=… → use THAT agent's locationId (deterministic + correct
 *      even when an agent is bound to a different location than the
 *      workspace's default)
 *   2. Otherwise → first location in the workspace where crmProvider='ghl'
 *      (skip native/none placeholders that can't possibly have calendars)
 *   3. Fall back to the legacy findFirst behaviour as a last resort.
 *
 * Response includes the resolved location id + crmProvider so the UI can
 * show "calendars from LeadConnector sub-account X".
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const { searchParams } = new URL(req.url)
  const agentId = searchParams.get('agentId')

  let location: { id: string; crmProvider: string | null } | null = null

  if (agentId) {
    const agent = await db.agent.findFirst({
      where: { id: agentId, workspaceId },
      select: { location: { select: { id: true, crmProvider: true } } },
    })
    if (agent?.location) location = agent.location as any
  }

  if (!location) {
    // Prefer a GHL location over native/none placeholders.
    location = await db.location.findFirst({
      where: { workspaceId, crmProvider: 'ghl' },
      select: { id: true, crmProvider: true },
    })
  }

  if (!location) {
    // Last-resort: any location at all (legacy behaviour).
    location = await db.location.findFirst({
      where: { workspaceId },
      select: { id: true, crmProvider: true },
    })
  }

  if (!location) {
    return NextResponse.json({ error: 'No location found for workspace' }, { status: 404 })
  }

  // Native / none / hubspot locations have no LeadConnector token. Surface
  // a clear signal to the UI rather than a generic 401 from token lookup.
  if (location.crmProvider !== 'ghl') {
    return NextResponse.json({
      calendars: [],
      locationId: location.id,
      crmProvider: location.crmProvider,
      error: 'not_ghl',
      message:
        'This agent is bound to a location that isn\'t connected to LeadConnector. Connect LeadConnector at the workspace level, OR rebind this agent to a LeadConnector location.',
    }, { status: 200 })
  }

  const locationId = location.id
  const token = await getValidAccessToken(locationId)
  if (!token) {
    return NextResponse.json({
      calendars: [],
      locationId,
      crmProvider: location.crmProvider,
      error: 'no_token',
      message: 'LeadConnector connection on this location has expired. Reconnect from Integrations.',
    }, { status: 200 })
  }

  const res = await fetch(
    `https://services.leadconnectorhq.com/calendars/?locationId=${locationId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Version: '2021-04-15',
        Accept: 'application/json',
      },
    }
  )

  if (!res.ok) {
    const body = await res.text()
    return NextResponse.json({
      calendars: [],
      locationId,
      crmProvider: location.crmProvider,
      error: body,
    }, { status: res.status })
  }

  const data = await res.json()
  return NextResponse.json({
    calendars: data.calendars ?? [],
    locationId,
    crmProvider: location.crmProvider,
  })
}
