/**
 * OAuth callback for Facebook Login.
 *
 * Meta redirects the user here with `?code=...&state=...` after they
 * approve our app. We:
 *
 *   1. Verify the HMAC-signed state to recover (locationId, workspaceId).
 *   2. Exchange the code for a short-lived user access token.
 *   3. Exchange that for a long-lived (~60 day) user access token.
 *   4. Hit /me/accounts to list every Page the user manages.
 *   5. For each page, save an Integration row with the page-specific
 *      access token (which inherits the long-lived expiry from the user
 *      token used to mint it). If the page is linked to an Instagram
 *      Business Account, capture that too.
 *   6. Redirect the operator back to the dashboard with a success or
 *      error indicator.
 *
 * We deliberately store ONE row per page — multi-page is supported and
 * each page picks its own agent via the existing routing-rules UI.
 *
 * Subscribing the page to webhook events (the `subscribed_apps` POST
 * with the `subscribed_fields` list) is NOT done here. That happens
 * out-of-band when the operator confirms which fields they want, and
 * can also be done manually in Meta's UI. Doing it automatically here
 * would couple OAuth to subscription state in a way that's hard to
 * unwind when the operator wants to disconnect.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { saveMetaIntegration } from '@/lib/meta-token-store'

export const dynamic = 'force-dynamic'

const STATE_MAX_AGE_MS = 10 * 60 * 1000 // 10 minutes — plenty for an OAuth round-trip

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')

  if (error) {
    return redirectToDashboard(req, { ok: false, error: error, detail: errorDescription ?? undefined })
  }
  if (!code || !state) {
    return redirectToDashboard(req, { ok: false, error: 'missing_code_or_state' })
  }

  const verified = verifyOAuthState(state)
  if (!verified.ok) {
    return redirectToDashboard(req, { ok: false, error: 'invalid_state', detail: verified.reason })
  }
  const { locationId, workspaceId } = verified

  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) {
    return redirectToDashboard(req, { ok: false, error: 'server_misconfigured' })
  }

  try {
    // Step 2: short-lived user token from the OAuth code.
    const redirectUri = buildRedirectUri(req)
    const shortToken = await exchangeCodeForUserToken({ appId, appSecret, code, redirectUri })

    // Step 3: long-lived user token (~60 days). Bumps the expiry from
    // the default ~1-2 hours so we don't re-prompt the user weekly.
    const longToken = await exchangeForLongLivedToken({ appId, appSecret, shortLivedToken: shortToken })

    // Step 4: list pages the user manages.
    const pages = await listPagesForUser(longToken.accessToken)
    if (pages.length === 0) {
      return redirectToDashboard(req, { ok: false, error: 'no_pages', detail: 'The connected Facebook account manages no Pages.' }, workspaceId)
    }

    // Step 5: store one Integration row per page. Page Access Tokens
    // inherit the long-lived expiry; we record it so the verify endpoint
    // can warn before they lapse.
    const issuedAt = new Date().toISOString()
    const expiresAt = longToken.expiresInSec
      ? new Date(Date.now() + longToken.expiresInSec * 1000).toISOString()
      : undefined

    let connectedCount = 0
    for (const page of pages) {
      try {
        await saveMetaIntegration({
          locationId,
          name: page.name,
          credentials: {
            pageId: page.id,
            pageAccessToken: page.accessToken,
            pageName: page.name,
            instagramBusinessAccountId: page.instagramBusinessAccountId,
            tokenIssuedAt: issuedAt,
            tokenExpiresAt: expiresAt,
          },
        })
        connectedCount++
      } catch (err: any) {
        console.error(`[meta-oauth] failed to save integration for page ${page.id}:`, err?.message)
      }
    }

    return redirectToDashboard(req, { ok: true, connectedPages: connectedCount }, workspaceId)
  } catch (err: any) {
    console.error('[meta-oauth] callback failed:', err?.message)
    return redirectToDashboard(req, { ok: false, error: 'token_exchange_failed', detail: err?.message }, workspaceId)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function buildRedirectUri(req: NextRequest): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
  const base = explicit ?? new URL(req.url).origin
  return new URL('/api/meta/oauth/callback', base).toString()
}

type VerifiedState =
  | { ok: true; locationId: string; workspaceId: string }
  | { ok: false; reason: string }

function verifyOAuthState(state: string): VerifiedState {
  const stateSecret = process.env.META_OAUTH_STATE_SECRET
  if (!stateSecret) return { ok: false, reason: 'state secret not configured' }
  const dot = state.lastIndexOf('.')
  if (dot < 0) return { ok: false, reason: 'malformed state' }
  const payload = state.slice(0, dot)
  const provided = state.slice(dot + 1)

  const expected = createHmac('sha256', stateSecret).update(payload).digest('hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  const providedBuf = Buffer.from(provided, 'hex')
  if (expectedBuf.length !== providedBuf.length) return { ok: false, reason: 'state digest length mismatch' }
  if (!timingSafeEqual(expectedBuf, providedBuf)) return { ok: false, reason: 'state signature mismatch' }

  let parsed: { locationId?: string; workspaceId?: string; ts?: number }
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed state payload' }
  }
  if (!parsed.locationId || !parsed.workspaceId) return { ok: false, reason: 'state missing fields' }
  if (typeof parsed.ts !== 'number' || Date.now() - parsed.ts > STATE_MAX_AGE_MS) {
    return { ok: false, reason: 'state expired' }
  }
  return { ok: true, locationId: parsed.locationId, workspaceId: parsed.workspaceId }
}

async function exchangeCodeForUserToken(p: { appId: string; appSecret: string; code: string; redirectUri: string }): Promise<string> {
  const url = new URL('https://graph.facebook.com/v19.0/oauth/access_token')
  url.searchParams.set('client_id', p.appId)
  url.searchParams.set('client_secret', p.appSecret)
  url.searchParams.set('redirect_uri', p.redirectUri)
  url.searchParams.set('code', p.code)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`code exchange failed: ${res.status} ${await res.text()}`)
  const data = await res.json() as { access_token?: string }
  if (!data.access_token) throw new Error('code exchange returned no access_token')
  return data.access_token
}

async function exchangeForLongLivedToken(p: { appId: string; appSecret: string; shortLivedToken: string }): Promise<{ accessToken: string; expiresInSec?: number }> {
  const url = new URL('https://graph.facebook.com/v19.0/oauth/access_token')
  url.searchParams.set('grant_type', 'fb_exchange_token')
  url.searchParams.set('client_id', p.appId)
  url.searchParams.set('client_secret', p.appSecret)
  url.searchParams.set('fb_exchange_token', p.shortLivedToken)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`long-lived exchange failed: ${res.status} ${await res.text()}`)
  const data = await res.json() as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new Error('long-lived exchange returned no access_token')
  return { accessToken: data.access_token, expiresInSec: data.expires_in }
}

interface PageInfo {
  id: string
  name: string
  accessToken: string
  instagramBusinessAccountId?: string
}

async function listPagesForUser(userAccessToken: string): Promise<PageInfo[]> {
  // Request the page's IG-business-account link in the same call so we
  // know which pages can serve Instagram DMs without a second round-trip.
  const url = new URL('https://graph.facebook.com/v19.0/me/accounts')
  url.searchParams.set('fields', 'id,name,access_token,instagram_business_account')
  url.searchParams.set('access_token', userAccessToken)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`list pages failed: ${res.status} ${await res.text()}`)
  const data = await res.json() as { data?: Array<{ id: string; name: string; access_token: string; instagram_business_account?: { id: string } }> }
  return (data.data ?? []).map(p => ({
    id: p.id,
    name: p.name,
    accessToken: p.access_token,
    instagramBusinessAccountId: p.instagram_business_account?.id,
  }))
}

function redirectToDashboard(req: NextRequest, result: { ok: boolean; error?: string; detail?: string; connectedPages?: number }, workspaceId?: string): NextResponse {
  const explicit = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
  const base = explicit ?? new URL(req.url).origin
  // Land on the workspace's integrations page when we know the workspace,
  // otherwise the workspace picker.
  const path = workspaceId
    ? `/dashboard/${workspaceId}/integrations`
    : '/dashboard'
  const dest = new URL(path, base)
  dest.searchParams.set('meta', result.ok ? 'connected' : 'error')
  if (typeof result.connectedPages === 'number') {
    dest.searchParams.set('pages', String(result.connectedPages))
  }
  if (result.error) dest.searchParams.set('reason', result.error)
  if (result.detail) dest.searchParams.set('detail', result.detail.slice(0, 200))
  return NextResponse.redirect(dest.toString())
}
