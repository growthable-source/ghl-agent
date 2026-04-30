/**
 * Initiate the Facebook Login OAuth flow for a workspace operator.
 *
 * Caller (the dashboard "Connect Meta" button) hits this with a
 * `?locationId=<id>` query param identifying which Location to attach
 * the resulting Page Access Tokens to. We sign that locationId into a
 * stateless `state` value, redirect to Meta's auth dialog, and the
 * callback verifies the state to bind the returned tokens back to the
 * right Location.
 *
 * Permissions requested:
 *   - pages_show_list      — list the user's Pages
 *   - pages_messaging      — send + receive Messenger DMs
 *   - pages_manage_metadata — subscribe Pages to webhooks
 *   - instagram_basic      — read IG Business Account info linked to a Page
 *   - instagram_manage_messages — send + receive Instagram DMs
 *
 * All five require Meta App Review for production use against
 * non-test users. Setup docs cover that.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'
import { createHmac, randomBytes } from 'node:crypto'

export const dynamic = 'force-dynamic'

const SCOPES = [
  'pages_show_list',
  'pages_messaging',
  'pages_manage_metadata',
  'instagram_basic',
  'instagram_manage_messages',
].join(',')

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const workspaceId = url.searchParams.get('workspaceId')
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
  }

  // Auth: only members of the workspace can initiate the flow.
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // Resolve a Location for the workspace to attach the integration to.
  // Native Meta works without GHL — if no Location exists yet (workspaces
  // that only use widget / direct channels), bootstrap a stub Location
  // with empty GHL-OAuth fields. The schema requires those columns; we
  // satisfy the constraint with empty strings + crmProvider='none' so
  // nothing in the GHL token-refresh path mistakes it for a real GHL
  // connection. Eventually the schema should make those nullable, but
  // this unblocks workspaces that haven't connected GHL.
  let location = await db.location.findFirst({
    where: { workspaceId },
    select: { id: true },
    orderBy: { installedAt: 'desc' },
  })
  if (!location) {
    try {
      location = await db.location.create({
        data: {
          id: `ws-${workspaceId}`,
          workspaceId,
          companyId: '',
          userId: '',
          userType: 'direct',
          scope: '',
          accessToken: '',
          refreshToken: '',
          refreshTokenId: '',
          expiresAt: new Date(0),
          crmProvider: 'none',
        },
        select: { id: true },
      })
    } catch (err: any) {
      console.error('[meta-oauth] failed to bootstrap Location for workspace:', err?.message)
      return NextResponse.json({ error: 'Could not bootstrap a Location for this workspace.' }, { status: 500 })
    }
  }
  const locationId = location.id

  const appId = process.env.META_APP_ID
  const stateSecret = process.env.META_OAUTH_STATE_SECRET
  if (!appId || !stateSecret) {
    return NextResponse.json(
      { error: 'Meta integration not configured (missing META_APP_ID or META_OAUTH_STATE_SECRET)' },
      { status: 500 },
    )
  }

  // Build a stateless, HMAC-signed `state` so the callback can verify
  // it without a server-side session row. Format:
  //   <base64url(JSON{locationId, workspaceId, nonce, ts})>.<hmac>
  const nonce = randomBytes(16).toString('hex')
  const ts = Date.now()
  const payload = Buffer.from(JSON.stringify({ locationId, workspaceId, nonce, ts })).toString('base64url')
  const sig = createHmac('sha256', stateSecret).update(payload).digest('hex')
  const state = `${payload}.${sig}`

  const redirectUri = buildRedirectUri(req)

  // Two OAuth flows are supported:
  //
  // 1. **Facebook Login for Business** (preferred). Set META_LOGIN_CONFIG_ID
  //    to a Configuration ID created in the Meta App dashboard. The
  //    configuration declares which Use Cases (Messenger / IG Messaging)
  //    and assets it covers, and the dialog explicitly surfaces
  //    Business-Manager-owned Pages — which classic FB Login does not.
  //    Required for any app that operates on BM-owned Pages.
  //
  // 2. **Classic Facebook Login** (fallback). Used when no config ID is
  //    set. Works for personal Pages and very small apps; fails to
  //    surface BM-owned Pages reliably. Useful for dev/test before the
  //    Business config is set up.
  const configId = process.env.META_LOGIN_CONFIG_ID
  const authUrl = new URL('https://www.facebook.com/v19.0/dialog/oauth')
  authUrl.searchParams.set('client_id', appId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('response_type', 'code')
  if (configId) {
    // Business Login — permissions live in the config, NOT the URL.
    // Passing both scope + config_id is invalid; Meta's docs require
    // exactly one. Configurations are managed in the App dashboard
    // under "Use cases → Customize → Facebook Login for Business →
    // Configurations".
    authUrl.searchParams.set('config_id', configId)
  } else {
    // Classic flow — scope drives the consent screen.
    authUrl.searchParams.set('scope', SCOPES)
  }

  return NextResponse.redirect(authUrl.toString())
}

function buildRedirectUri(req: NextRequest): string {
  // Prefer an explicit base so dev / preview / prod each register a
  // stable redirect URI in the Meta App settings. Falls back to the
  // request's own origin so it Just Works in dev.
  const explicit = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
  const base = explicit ?? new URL(req.url).origin
  return new URL('/api/meta/oauth/callback', base).toString()
}
