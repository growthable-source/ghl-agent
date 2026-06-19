/**
 * Config the client needs to open the Google Picker: a fresh access token
 * (minted from the stored refresh token), the OAuth client id, the Picker API
 * key, and the Cloud project number (appId). Dormant until enabled + a
 * connection exists.
 *
 *   GET /api/integrations/google-content/picker-config?workspaceId=ws_…
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { isGoogleContentEnabled, refreshAccessToken } from '@/lib/google/content-oauth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isGoogleContentEnabled()) {
    return NextResponse.json({ error: 'Google content connector is not enabled' }, { status: 404 })
  }
  const workspaceId = new URL(req.url).searchParams.get('workspaceId')
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })

  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const conn = await db.googleContentConnection.findUnique({ where: { workspaceId } })
  if (!conn?.isActive) return NextResponse.json({ error: 'not_connected' }, { status: 409 })

  const apiKey = process.env.GOOGLE_PICKER_API_KEY
  const clientId = process.env.GOOGLE_CLIENT_ID
  const appId = process.env.GOOGLE_CLOUD_PROJECT_NUMBER // Picker "appId"
  if (!apiKey || !clientId) {
    return NextResponse.json({ error: 'Picker not configured (GOOGLE_PICKER_API_KEY / GOOGLE_CLIENT_ID)' }, { status: 500 })
  }

  try {
    const { accessToken } = await refreshAccessToken(conn.refreshToken)
    return NextResponse.json({ accessToken, apiKey, clientId, appId: appId ?? null })
  } catch (err) {
    return NextResponse.json(
      { error: 'token_refresh_failed', detail: err instanceof Error ? err.message : undefined },
      { status: 502 },
    )
  }
}
