import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'
import { agencyOAuthConfigured, AGENCY_OAUTH_SCOPES } from '@/lib/leadconnector-agency'
import { agencyStateSecret, signAgencyState } from '@/lib/agency-oauth-state'

/**
 * GET /api/auth/leadconnector-agency/install?widgetId=...&variant=whitelabel|standard
 * Kicks off the AGENCY-level OAuth install (Company scope) for the
 * separate location-control marketplace app. One widget connects to one
 * agency, so the flow is keyed by widget. Admin+ on the widget's
 * workspace only.
 *
 * variant picks the marketplace domain the user signs in on:
 *   whitelabel (default) → marketplace.leadconnectorhq.com — works for
 *                          agencies living on whitelabel domains
 *   standard             → marketplace.gohighlevel.com — for users whose
 *                          session lives on the standard domain
 * Same app, same client id, same callback; only the login surface
 * differs. Path is /v2/oauth/chooselocation — the exact form the
 * marketplace generates for this app (v1 /oauth/chooseaccount 404s).
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
  const secret = agencyStateSecret()
  if (!secret) {
    return NextResponse.redirect(new URL(`${settingsUrl}?error=not_configured`, req.url))
  }
  // Signed + expiring, and names who started the flow: the callback
  // re-checks this user's admin access before saving anything.
  const state = signAgencyState({
    widgetId: widget.id,
    workspaceId: widget.workspaceId,
    portalReturn: false,
    actor: { kind: 'user', userId: access.session.user!.id! },
  }, secret)
  const clientId = process.env.LEADCONNECTOR_AGENCY_CLIENT_ID!
  // version_id is the app id — also the prefix of the client id
  // ("<appId>-<suffix>"), so derive it when the env var isn't set.
  const versionId = process.env.LEADCONNECTOR_AGENCY_VERSION_ID ?? clientId.split('-')[0]
  const domain = req.nextUrl.searchParams.get('variant') === 'standard'
    ? 'marketplace.gohighlevel.com'
    : 'marketplace.leadconnectorhq.com'
  const chooser = new URL(`https://${domain}/v2/oauth/chooselocation`)
  chooser.searchParams.set('response_type', 'code')
  chooser.searchParams.set('client_id', clientId)
  chooser.searchParams.set('redirect_uri', `${process.env.APP_URL}/api/auth/leadconnector-agency/callback`)
  chooser.searchParams.set('scope', AGENCY_OAUTH_SCOPES)
  chooser.searchParams.set('version_id', versionId)
  chooser.searchParams.set('state', state)
  return NextResponse.redirect(chooser)
}
