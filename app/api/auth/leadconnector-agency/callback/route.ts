import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { exchangeAgencyCode, fetchCompanyName, syncAgencyLocations } from '@/lib/leadconnector-agency'
import { agencyStateSecret, unverifiedPortalReturn, verifyAgencyState } from '@/lib/agency-oauth-state'
import { actorMayConnectWidget } from '@/lib/agency-oauth-authority'

/**
 * GET /api/auth/leadconnector-agency/callback
 * Agency-level OAuth callback for the location-control app. Upserts the
 * WIDGET's AgencyConnection (one widget ↔ one agency) and runs the first
 * location sync inline (agencies are typically <1k locations; well
 * within route timeout).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const rawState = searchParams.get('state')

  // The state is HMAC-signed by the install routes (lib/agency-oauth-state.ts).
  // Nothing in an unverified state is trusted; on failure we only peek at
  // portalReturn to choose which page shows the error.
  const secret = agencyStateSecret()
  const verified = secret ? verifyAgencyState(rawState, secret) : null
  const state = verified?.ok ? verified.state : null
  const widgetId: string | null = state?.widgetId ?? null
  const workspaceId: string | null = state?.workspaceId ?? null
  // Flow started from /portal/locations (portal-install route) — land
  // the user back in the portal, not the dashboard they can't access.
  const portalReturn = state ? state.portalReturn : unverifiedPortalReturn(rawState)

  const fail = (error: string) => NextResponse.redirect(
    new URL(portalReturn
      ? `/portal/locations?error=${encodeURIComponent(error)}`
      : widgetId && workspaceId
        ? `/dashboard/${workspaceId}/widgets/${widgetId}/locations?error=${encodeURIComponent(error)}`
        : `/dashboard?error=${encodeURIComponent(error)}`, req.url),
  )

  if (!state || !widgetId || !workspaceId) {
    if (verified && !verified.ok) {
      console.warn('[AgencyOAuth] rejected state:', verified.reason)
      return fail(verified.reason === 'expired' ? 'state_expired' : 'bad_state')
    }
    return fail('missing_state')
  }
  if (searchParams.get('error')) return fail(searchParams.get('error')!)
  if (!code) return fail('missing_code')

  try {
    // Re-validate the state against the DB — the widget must exist and
    // belong to the workspace named in state.
    const widget = await db.chatWidget.findUnique({
      where: { id: widgetId },
      select: { id: true, workspaceId: true, brandId: true },
    })
    if (!widget || widget.workspaceId !== workspaceId) return fail('widget_not_found')
    // The person who started the flow must STILL be allowed to connect
    // this widget — checked before the code exchange, so a refused
    // callback never touches the token endpoint or the connection row.
    if (!(await actorMayConnectWidget(state.actor, widget))) {
      console.warn('[AgencyOAuth] actor not allowed for widget', widget.id, state.actor.kind)
      return fail('not_allowed')
    }

    let t
    try {
      t = await exchangeAgencyCode(code)
    } catch (err: any) {
      console.error('[AgencyOAuth] token exchange failed:', err?.message)
      return fail('token_exchange_failed')
    }
    if (!t.companyId) {
      console.error('[AgencyOAuth] grant carried no companyId — userType:', t.userType, 'keys:', Object.keys(t).join(','))
      return fail('no_company_in_grant')
    }

    // Agency display name for the connection card. Best-effort — null on
    // 403/timeout, and the upsert retries without the field on DBs that
    // haven't run the companyName ALTER yet.
    const companyName = await fetchCompanyName(t.access_token, t.companyId)
    const tokenData = {
      workspaceId: widget.workspaceId,
      companyId: t.companyId,
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiresAt: new Date(Date.now() + (t.expires_in ?? 86400) * 1000),
      scope: Array.isArray(t.scope) ? t.scope.join(' ') : (t.scope ?? ''),
      tokenRefreshFailedAt: null,
    }
    const doUpsert = (extra: { companyName?: string | null }) =>
      db.agencyConnection.upsert({
        where: { widgetId: widget.id },
        create: {
          widgetId: widget.id,
          ...tokenData,
          ...extra,
          connectedByUserId: state.actor.kind === 'user' ? state.actor.userId : null,
        },
        update: { ...tokenData, ...extra },
      })
    const conn = companyName
      ? await doUpsert({ companyName }).catch(() => doUpsert({}))
      : await doUpsert({})

    // First sync inline; failure is non-fatal (Refresh button retries).
    await syncAgencyLocations(conn.id).catch(err =>
      console.warn('[AgencyOAuth] initial location sync failed:', err?.message))

    return NextResponse.redirect(
      new URL(portalReturn
        ? '/portal/locations?connected=1'
        : `/dashboard/${workspaceId}/widgets/${widgetId}/locations?connected=1`, req.url),
    )
  } catch (err: any) {
    console.error('[AgencyOAuth] callback error:', err?.code, err?.message)
    // P2021 = AgencyConnection/AgencyLocation tables don't exist yet —
    // the hand-run SQL hasn't been applied. Distinct error so the page
    // can say exactly that instead of a generic auth failure.
    if (err?.code === 'P2021') return fail('db_not_migrated')
    return fail('connection_save_failed')
  }
}
