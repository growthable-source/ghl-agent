import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'
import { agencyOAuthConfigured, AGENCY_OAUTH_SCOPES } from '@/lib/leadconnector-agency'

/**
 * GET /api/auth/leadconnector-agency/portal-install?widgetId=...&variant=whitelabel|standard
 *
 * Portal-side twin of the dashboard install route: lets a PORTAL user
 * (the agency themselves) start the agency OAuth for one of their
 * widgets — they're the ones with the agency login, so self-serve is
 * the natural flow. Auth is the portal session; the widget must belong
 * to one of the session's brands. The shared callback returns to
 * /portal/locations (portalReturn flag in state).
 *
 * NOTE: API route answering with a 302 — link with a plain <a>.
 */
export async function GET(req: NextRequest) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const widgetId = req.nextUrl.searchParams.get('widgetId')
  if (!widgetId) return NextResponse.json({ error: 'widgetId required' }, { status: 400 })

  const widget = await db.chatWidget.findFirst({
    where: { id: widgetId, brandId: { in: session.brandIds } },
    select: { id: true, workspaceId: true },
  })
  if (!widget) return NextResponse.json({ error: 'Widget not found in your portal' }, { status: 404 })

  if (!agencyOAuthConfigured()) {
    return NextResponse.redirect(new URL('/portal/locations?error=not_configured', req.url))
  }

  const state = Buffer.from(
    JSON.stringify({ widgetId: widget.id, workspaceId: widget.workspaceId, portalReturn: true }),
    'utf8',
  ).toString('base64url')
  const clientId = process.env.LEADCONNECTOR_AGENCY_CLIENT_ID!
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
