import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'
import { agencyOAuthConfigured, AGENCY_OAUTH_SCOPES } from '@/lib/leadconnector-agency'

/**
 * GET /api/auth/leadconnector-agency/install?workspaceId=...
 * Kicks off the AGENCY-level OAuth install (Company scope) for the
 * separate location-control marketplace app. Admin+ only.
 */
export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspaceId')
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
  }
  const access = await requireWorkspaceRole(workspaceId, 'admin')
  if (access instanceof NextResponse) return access
  if (!agencyOAuthConfigured()) {
    return NextResponse.redirect(
      new URL(`/dashboard/${workspaceId}/locations?error=not_configured`, req.url),
    )
  }
  const state = Buffer.from(JSON.stringify({ workspaceId }), 'utf8').toString('base64url')
  const chooser = new URL('https://marketplace.leadconnectorhq.com/oauth/chooseaccount')
  chooser.searchParams.set('response_type', 'code')
  chooser.searchParams.set('client_id', process.env.LEADCONNECTOR_AGENCY_CLIENT_ID!)
  chooser.searchParams.set('redirect_uri', `${process.env.APP_URL}/api/auth/leadconnector-agency/callback`)
  chooser.searchParams.set('scope', AGENCY_OAUTH_SCOPES)
  chooser.searchParams.set('state', state)
  return NextResponse.redirect(chooser)
}
