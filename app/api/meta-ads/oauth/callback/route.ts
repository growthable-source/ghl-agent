/**
 * Meta Ads OAuth callback. Mirror of the Pages callback but persists to
 * MetaAdAccount instead of Integration. One row per ad account the user
 * granted us — operator can toggle isActive / autoPilotEnabled later.
 *
 * Token model: Meta returns a User Access Token with ads_management +
 * business_management scopes. We exchange it for a long-lived (~60 day)
 * token and store that. For long-running automation we'd ideally use a
 * System User token (no expiry), but those require Business Verification
 * and a UI flow we don't have yet — long-lived user token is the
 * pragmatic default; we record tokenExpiresAt so the UI can warn before
 * it lapses.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const STATE_MAX_AGE_MS = 10 * 60 * 1000

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')

  if (error) {
    return redirectBack(req, undefined, { ok: false, error, detail: errorDescription ?? undefined })
  }
  if (!code || !state) {
    return redirectBack(req, undefined, { ok: false, error: 'missing_code_or_state' })
  }

  const verified = verifyOAuthState(state)
  if (!verified.ok) {
    return redirectBack(req, undefined, { ok: false, error: 'invalid_state', detail: verified.reason })
  }
  const { workspaceId } = verified

  const appId = process.env.META_APP_ID
  const appSecret = process.env.META_APP_SECRET
  if (!appId || !appSecret) {
    return redirectBack(req, workspaceId, { ok: false, error: 'server_misconfigured' })
  }

  try {
    const redirectUri = buildRedirectUri(req)
    const shortToken = await exchangeCodeForUserToken({ appId, appSecret, code, redirectUri })
    const longToken = await exchangeForLongLivedToken({ appId, appSecret, shortLivedToken: shortToken })

    // Read user identity for the activity log.
    const whoami = await describeUser(longToken.accessToken).catch(() => null)

    const adAccounts = await listAdAccountsForUser(longToken.accessToken)
    if (adAccounts.length === 0) {
      return redirectBack(req, workspaceId, {
        ok: false,
        error: 'no_ad_accounts',
        detail: `${whoami?.name ? `Authorised as ${whoami.name}. ` : ''}/me/adaccounts returned 0 ad accounts. Confirm your user has the "Manage campaigns" task on at least one ad account in Business Settings → Users.`,
      })
    }

    let connectedCount = 0
    let updatedCount = 0
    for (const acc of adAccounts) {
      try {
        // act_<id> is what the Marketing API expects in URL paths; store
        // it WITHOUT the prefix so the column matches the bare numeric
        // id (the prefix is added at call sites). The unique key is
        // (workspaceId, metaAccountId).
        const metaAccountId = acc.id.replace(/^act_/, '')

        const existing = await db.metaAdAccount.findUnique({
          where: { workspaceId_metaAccountId: { workspaceId, metaAccountId } },
          select: { id: true },
        })

        if (existing) {
          // Reconnect — refresh the token and re-activate.
          await db.metaAdAccount.update({
            where: { id: existing.id },
            data: {
              accountName: acc.name,
              accessToken: longToken.accessToken,
              isActive: true,
            },
          })
          await db.adActivityLog.create({
            data: {
              metaAccountId: existing.id,
              actionType: 'oauth_reconnect',
              description: `Reconnected by ${whoami?.name ?? 'user'} (${whoami?.id ?? '?'})`,
              performedBy: whoami?.id ?? 'system',
              details: { tokenExpiresInSec: longToken.expiresInSec ?? null } as object,
            },
          }).catch(() => {})
          updatedCount++
        } else {
          const created = await db.metaAdAccount.create({
            data: {
              workspaceId,
              accountName: acc.name,
              metaAccountId,
              accessToken: longToken.accessToken,
              isActive: true,
              autoPilotEnabled: false,
            },
            select: { id: true },
          })
          await db.adActivityLog.create({
            data: {
              metaAccountId: created.id,
              actionType: 'oauth_connect',
              description: `Connected ad account "${acc.name}" by ${whoami?.name ?? 'user'} (${whoami?.id ?? '?'})`,
              performedBy: whoami?.id ?? 'system',
              details: { tokenExpiresInSec: longToken.expiresInSec ?? null } as object,
            },
          }).catch(() => {})
          connectedCount++
        }
      } catch (err) {
        console.error(`[meta-ads-oauth] failed to save ad account ${acc.id}:`, err instanceof Error ? err.message : err)
      }
    }

    return redirectBack(req, workspaceId, {
      ok: true,
      connectedAccounts: connectedCount,
      updatedAccounts: updatedCount,
    })
  } catch (err) {
    console.error('[meta-ads-oauth] callback failed:', err instanceof Error ? err.message : err)
    return redirectBack(req, workspaceId, {
      ok: false,
      error: 'token_exchange_failed',
      detail: err instanceof Error ? err.message : undefined,
    })
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function buildRedirectUri(req: NextRequest): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
  const base = explicit ?? new URL(req.url).origin
  return new URL('/api/meta-ads/oauth/callback', base).toString()
}

type VerifiedState = { ok: true; workspaceId: string } | { ok: false; reason: string }

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

  let parsed: { workspaceId?: string; ts?: number; kind?: string }
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed state payload' }
  }
  if (!parsed.workspaceId) return { ok: false, reason: 'state missing workspaceId' }
  if (parsed.kind !== 'meta_ads') return { ok: false, reason: 'state kind mismatch' }
  if (typeof parsed.ts !== 'number' || Date.now() - parsed.ts > STATE_MAX_AGE_MS) {
    return { ok: false, reason: 'state expired' }
  }
  return { ok: true, workspaceId: parsed.workspaceId }
}

async function exchangeCodeForUserToken(p: {
  appId: string
  appSecret: string
  code: string
  redirectUri: string
}): Promise<string> {
  const url = new URL('https://graph.facebook.com/v19.0/oauth/access_token')
  url.searchParams.set('client_id', p.appId)
  url.searchParams.set('client_secret', p.appSecret)
  url.searchParams.set('redirect_uri', p.redirectUri)
  url.searchParams.set('code', p.code)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`code exchange failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { access_token?: string }
  if (!data.access_token) throw new Error('code exchange returned no access_token')
  return data.access_token
}

async function exchangeForLongLivedToken(p: {
  appId: string
  appSecret: string
  shortLivedToken: string
}): Promise<{ accessToken: string; expiresInSec?: number }> {
  const url = new URL('https://graph.facebook.com/v19.0/oauth/access_token')
  url.searchParams.set('grant_type', 'fb_exchange_token')
  url.searchParams.set('client_id', p.appId)
  url.searchParams.set('client_secret', p.appSecret)
  url.searchParams.set('fb_exchange_token', p.shortLivedToken)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`long-lived exchange failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new Error('long-lived exchange returned no access_token')
  return { accessToken: data.access_token, expiresInSec: data.expires_in }
}

async function describeUser(userAccessToken: string): Promise<{ id: string; name?: string } | null> {
  const url = new URL('https://graph.facebook.com/v19.0/me')
  url.searchParams.set('fields', 'id,name')
  url.searchParams.set('access_token', userAccessToken)
  const res = await fetch(url.toString())
  if (!res.ok) return null
  const data = (await res.json()) as { id?: string; name?: string }
  if (!data.id) return null
  return { id: data.id, name: data.name }
}

interface AdAccountInfo {
  id: string // act_<id>
  name: string
  currency?: string
  timezoneName?: string
}

async function listAdAccountsForUser(userAccessToken: string): Promise<AdAccountInfo[]> {
  const url = new URL('https://graph.facebook.com/v19.0/me/adaccounts')
  url.searchParams.set('fields', 'id,name,account_status,currency,timezone_name')
  url.searchParams.set('limit', '200')
  url.searchParams.set('access_token', userAccessToken)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`list ad accounts failed: ${res.status} ${await res.text()}`)
  const data = (await res.json()) as {
    data?: Array<{
      id: string
      name: string
      account_status?: number
      currency?: string
      timezone_name?: string
    }>
  }
  // account_status: 1 = ACTIVE, 2 = DISABLED. Surface only ACTIVE so we
  // don't bind a token to an account the user can't transact on.
  return (data.data ?? [])
    .filter((a) => a.account_status === undefined || a.account_status === 1)
    .map((a) => ({
      id: a.id,
      name: a.name,
      currency: a.currency,
      timezoneName: a.timezone_name,
    }))
}

function redirectBack(
  req: NextRequest,
  workspaceId: string | undefined,
  result: {
    ok: boolean
    error?: string
    detail?: string
    connectedAccounts?: number
    updatedAccounts?: number
  },
): NextResponse {
  const explicit = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL
  const base = explicit ?? new URL(req.url).origin
  const path = workspaceId ? `/dashboard/${workspaceId}/integrations` : '/dashboard'
  const dest = new URL(path, base)
  dest.searchParams.set('meta_ads', result.ok ? 'connected' : 'error')
  if (typeof result.connectedAccounts === 'number') {
    dest.searchParams.set('connected', String(result.connectedAccounts))
  }
  if (typeof result.updatedAccounts === 'number') {
    dest.searchParams.set('updated', String(result.updatedAccounts))
  }
  if (result.error) dest.searchParams.set('reason', result.error)
  if (result.detail) dest.searchParams.set('detail', result.detail.slice(0, 200))
  return NextResponse.redirect(dest.toString())
}
