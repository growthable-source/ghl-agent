/**
 * Initiate Google Ads OAuth.
 *
 * Reuses GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET from the conversion
 * upload path, but with the `auth/adwords` scope so the refresh token
 * can mint access tokens for the Google Ads API (not just conversion
 * uploads — full campaign/budget/ad management).
 *
 * Flow:
 *   1. /api/google-ads/oauth/connect?workspaceId=ws_… → 302 to accounts.google.com
 *   2. → /api/google-ads/oauth/callback?code=…&state=…
 *   3. callback exchanges code → refresh_token, lists accessible
 *      customers, persists one GoogleAdAccount per customer ID.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { createHmac, randomBytes } from 'node:crypto'

export const dynamic = 'force-dynamic'

// auth/adwords is the Google Ads API scope. We include userinfo.email
// so the callback can record who authorised in the activity log.
const SCOPES = [
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const workspaceId = url.searchParams.get('workspaceId')
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
  }

  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const clientId = process.env.GOOGLE_CLIENT_ID
  const stateSecret = process.env.GOOGLE_OAUTH_STATE_SECRET ?? process.env.META_OAUTH_STATE_SECRET
  if (!clientId || !stateSecret) {
    return NextResponse.json(
      {
        error:
          'Google Ads integration not configured (missing GOOGLE_CLIENT_ID or GOOGLE_OAUTH_STATE_SECRET)',
      },
      { status: 500 },
    )
  }

  const nonce = randomBytes(16).toString('hex')
  const ts = Date.now()
  const payload = Buffer.from(JSON.stringify({ workspaceId, nonce, ts, kind: 'google_ads' })).toString('base64url')
  const sig = createHmac('sha256', stateSecret).update(payload).digest('hex')
  const state = `${payload}.${sig}`

  const redirectUri = buildRedirectUri(req)

  // access_type=offline + prompt=consent guarantees Google returns a
  // refresh_token even when the user has previously authorised — without
  // prompt=consent, repeat authorisations omit refresh_token and we
  // can't mint future access tokens.
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', SCOPES)
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('include_granted_scopes', 'true')

  return NextResponse.redirect(authUrl.toString())
}

function buildRedirectUri(req: NextRequest): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
  const base = explicit ?? new URL(req.url).origin
  return new URL('/api/google-ads/oauth/callback', base).toString()
}
