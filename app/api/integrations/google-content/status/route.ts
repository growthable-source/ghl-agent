/**
 * Connection status for the Google content connector — drives the UI's
 * "Connect / Connected as …" state. Always returns `enabled` so the UI can
 * hide the feature entirely when the flag is off.
 *
 *   GET /api/integrations/google-content/status?workspaceId=ws_…
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { isGoogleContentEnabled } from '@/lib/google/content-oauth'

export async function GET(req: NextRequest) {
  const enabled = isGoogleContentEnabled()
  const workspaceId = new URL(req.url).searchParams.get('workspaceId')
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })

  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  if (!enabled) return NextResponse.json({ enabled: false, connected: false })

  const conn = await db.googleContentConnection.findUnique({
    where: { workspaceId },
    select: { email: true, isActive: true, scopes: true },
  }).catch(() => null)

  return NextResponse.json({
    enabled: true,
    connected: !!conn?.isActive,
    email: conn?.email ?? null,
    gmailAvailable: false, // flipped on once gmail.readonly verification lands
  })
}
