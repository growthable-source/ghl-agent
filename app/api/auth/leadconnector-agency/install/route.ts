import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'
import { agencyOAuthConfigured, AGENCY_OAUTH_SCOPES } from '@/lib/leadconnector-agency'

/**
 * GET /api/auth/leadconnector-agency/install?widgetId=...
 * Kicks off the AGENCY-level OAuth install (Company scope) for the
 * separate location-control marketplace app. One widget connects to one
 * agency, so the flow is keyed by widget. Admin+ on the widget's
 * workspace only.
 *
 * NOTE: this is an API route that answers with a 302 to the OAuth
 * chooser — link to it with a plain <a>, not next/link (client-side
 * router navigation can't resolve API routes and 404s).
 */
export async function GET(req: NextRequest) {
  const widgetId = req.nextUrl.searchParams.get('widgetId')
  if (!widgetId) {
    return NextResponse.json({ error: 'widgetId required' }, { status: 400 })
  }
  const widget = await db.chatWidget.findUnique({
    where: { id: widgetId },
    select: { id: true, workspaceId: true },
  })
  if (!widget) {
    return NextResponse.json({ error: 'Widget not found' }, { status: 404 })
  }
  const access = await requireWorkspaceRole(widget.workspaceId, 'admin')
  if (access instanceof NextResponse) return access

  const settingsUrl = `/dashboard/${widget.workspaceId}/widgets/${widget.id}/locations`
  if (!agencyOAuthConfigured()) {
    return NextResponse.redirect(new URL(`${settingsUrl}?error=not_configured`, req.url))
  }
  const state = Buffer.from(
    JSON.stringify({ widgetId: widget.id, workspaceId: widget.workspaceId }),
    'utf8',
  ).toString('base64url')
  const chooser = new URL('https://marketplace.leadconnectorhq.com/oauth/chooseaccount')
  chooser.searchParams.set('response_type', 'code')
  chooser.searchParams.set('client_id', process.env.LEADCONNECTOR_AGENCY_CLIENT_ID!)
  chooser.searchParams.set('redirect_uri', `${process.env.APP_URL}/api/auth/leadconnector-agency/callback`)
  chooser.searchParams.set('scope', AGENCY_OAUTH_SCOPES)
  chooser.searchParams.set('state', state)
  return NextResponse.redirect(chooser)
}
