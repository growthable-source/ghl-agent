/**
 * Initiate Meta Ads OAuth — distinct from /api/meta/oauth/connect (Pages
 * for Messenger/IG DMs) because the ad-account flow needs ads_management,
 * ads_read, and business_management scopes, plus a different callback.
 *
 * Reuses META_APP_ID / META_APP_SECRET / META_OAUTH_STATE_SECRET — there's
 * one Meta App per deployment that holds both the messaging and ads
 * permissions. If Xovera ever needs to split them into two App IDs,
 * factor a META_ADS_APP_ID env var here.
 *
 * Flow:
 *   1. /api/meta-ads/oauth/connect?workspaceId=ws_… → 302 to dialog.facebook.com
 *   2. user picks ad accounts in Facebook Login for Business dialog
 *   3. → /api/meta-ads/oauth/callback?code=…&state=…
 *   4. callback persists one MetaAdAccount per granted ad account
 *   5. → /dashboard/<workspaceId>/integrations?meta_ads=connected
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { createHmac, randomBytes } from 'node:crypto'

export const dynamic = 'force-dynamic'

const SCOPES = [
  'ads_management',
  'ads_read',
  'business_management',
  'pages_show_list',
  'read_insights',
].join(',')

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const workspaceId = url.searchParams.get('workspaceId')
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
  }

  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const appId = process.env.META_APP_ID
  const stateSecret = process.env.META_OAUTH_STATE_SECRET
  if (!appId || !stateSecret) {
    return NextResponse.json(
      { error: 'Meta integration not configured (missing META_APP_ID or META_OAUTH_STATE_SECRET)' },
      { status: 500 },
    )
  }

  const nonce = randomBytes(16).toString('hex')
  const ts = Date.now()
  const payload = Buffer.from(JSON.stringify({ workspaceId, nonce, ts, kind: 'meta_ads' })).toString('base64url')
  const sig = createHmac('sha256', stateSecret).update(payload).digest('hex')
  const state = `${payload}.${sig}`

  const redirectUri = buildRedirectUri(req)

  // META_ADS_LOGIN_CONFIG_ID — separate Configuration ID from the
  // messaging one, declaring "Marketing API" use case + ad-account
  // selector. Without it we fall back to classic FB Login with the
  // SCOPES list, which works but doesn't surface BM-owned ad accounts
  // as cleanly. Recommended: create a dedicated Business config.
  const configId = process.env.META_ADS_LOGIN_CONFIG_ID

  const authUrl = new URL('https://www.facebook.com/v19.0/dialog/oauth')
  authUrl.searchParams.set('client_id', appId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('response_type', 'code')
  if (configId) {
    authUrl.searchParams.set('config_id', configId)
  } else {
    authUrl.searchParams.set('scope', SCOPES)
  }

  return NextResponse.redirect(authUrl.toString())
}

function buildRedirectUri(req: NextRequest): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
  const base = explicit ?? new URL(req.url).origin
  return new URL('/api/meta-ads/oauth/callback', base).toString()
}
