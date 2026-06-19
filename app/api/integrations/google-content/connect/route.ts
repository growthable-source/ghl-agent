/**
 * Start the Google content (Drive) OAuth connect flow for a workspace.
 * Dormant until GOOGLE_CONTENT_ENABLED=true. Reuses the app's Google OAuth
 * client; adds the drive.file scope in a separate consent from login.
 *
 *   /api/integrations/google-content/connect?workspaceId=ws_… → 302 to Google
 *   → /api/integrations/google-content/callback
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { buildAuthUrl, isGoogleContentEnabled } from '@/lib/google/content-oauth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isGoogleContentEnabled()) {
    return NextResponse.json({ error: 'Google content connector is not enabled' }, { status: 404 })
  }

  const workspaceId = new URL(req.url).searchParams.get('workspaceId')
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })

  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const redirectUri = buildRedirectUri(req)
  const authUrl = buildAuthUrl({ workspaceId, redirectUri })
  if (!authUrl) {
    return NextResponse.json(
      { error: 'Google connector not configured (missing GOOGLE_CLIENT_ID or GOOGLE_OAUTH_STATE_SECRET)' },
      { status: 500 },
    )
  }
  return NextResponse.redirect(authUrl)
}

function buildRedirectUri(req: NextRequest): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || new URL(req.url).origin
  return new URL('/api/integrations/google-content/callback', base).toString()
}
