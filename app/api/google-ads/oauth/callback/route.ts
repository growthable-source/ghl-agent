/**
 * Google Ads OAuth callback. Exchanges the authorization code for a
 * refresh_token, then calls Google Ads API listAccessibleCustomers to
 * discover which customer IDs the user can act on. Persists one
 * GoogleAdAccount per accessible customer.
 *
 * Notes:
 *  - Refresh tokens are returned ONCE per (user, app) pair. The connect
 *    endpoint forces prompt=consent so we always get one. We store it
 *    on every GoogleAdAccount row even though it's the same value across
 *    sibling customers — keeps the row self-contained for token refresh
 *    without joining back to a parent record.
 *  - listAccessibleCustomers returns "manager" account customer IDs as
 *    well as direct ones. We don't filter — operators may legitimately
 *    want to manage at the manager level. The UI surfaces both with
 *    the customer ID so they can tell which is which.
 *  - Customer IDs are stored unhyphenated (the API expects no dashes
 *    when constructing resource names like customers/<id>/campaigns).
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

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const developerToken = process.env.GOOGLE_DEVELOPER_TOKEN
  if (!clientId || !clientSecret) {
    return redirectBack(req, workspaceId, { ok: false, error: 'server_misconfigured', detail: 'GOOGLE_CLIENT_ID/SECRET missing' })
  }
  if (!developerToken) {
    return redirectBack(req, workspaceId, { ok: false, error: 'server_misconfigured', detail: 'GOOGLE_DEVELOPER_TOKEN missing' })
  }

  try {
    const redirectUri = buildRedirectUri(req)
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })
    const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
      access_token?: string
      refresh_token?: string
      expires_in?: number
      error?: string
      error_description?: string
    }
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(`token_exchange_failed: ${tokenJson.error_description ?? tokenJson.error ?? tokenRes.status}`)
    }
    if (!tokenJson.refresh_token) {
      throw new Error('no_refresh_token_returned — connect again with prompt=consent')
    }

    const refreshToken = tokenJson.refresh_token
    const accessToken = tokenJson.access_token

    const userInfo = await describeUser(accessToken).catch(() => null)

    const customerIds = await listAccessibleCustomers({ accessToken, developerToken })
    if (customerIds.length === 0) {
      return redirectBack(req, workspaceId, {
        ok: false,
        error: 'no_customers',
        detail: `${userInfo?.email ? `Authorised as ${userInfo.email}. ` : ''}listAccessibleCustomers returned no customers. Confirm the Google account has access to at least one Google Ads customer.`,
      })
    }

    // Try to enrich each customer with descriptive name + currency. Falls
    // back to "Customer <id>" if the searchStream call fails (developer
    // token not yet approved for the manager, etc.) — we still want to
    // save the row so the operator can re-fetch later.
    const enriched = await Promise.all(
      customerIds.map(async (customerId) => {
        const meta = await describeCustomer({ customerId, accessToken, developerToken }).catch(() => null)
        return {
          customerId,
          descriptiveName: meta?.descriptiveName ?? `Customer ${formatCustomerId(customerId)}`,
          currency: meta?.currencyCode,
        }
      }),
    )

    let connectedCount = 0
    let updatedCount = 0
    for (const acc of enriched) {
      try {
        const existing = await db.googleAdAccount.findUnique({
          where: { workspaceId_googleCustomerId: { workspaceId, googleCustomerId: acc.customerId } },
          select: { id: true },
        })

        if (existing) {
          await db.googleAdAccount.update({
            where: { id: existing.id },
            data: {
              accountName: acc.descriptiveName,
              refreshToken,
              isActive: true,
            },
          })
          await db.adActivityLog.create({
            data: {
              googleAccountId: existing.id,
              actionType: 'oauth_reconnect',
              description: `Reconnected by ${userInfo?.email ?? 'user'}`,
              performedBy: userInfo?.email ?? 'system',
              details: { currency: acc.currency ?? null } as object,
            },
          }).catch(() => {})
          updatedCount++
        } else {
          const created = await db.googleAdAccount.create({
            data: {
              workspaceId,
              accountName: acc.descriptiveName,
              googleCustomerId: acc.customerId,
              refreshToken,
              isActive: true,
              autoPilotEnabled: false,
            },
            select: { id: true },
          })
          await db.adActivityLog.create({
            data: {
              googleAccountId: created.id,
              actionType: 'oauth_connect',
              description: `Connected customer "${acc.descriptiveName}" by ${userInfo?.email ?? 'user'}`,
              performedBy: userInfo?.email ?? 'system',
              details: { currency: acc.currency ?? null } as object,
            },
          }).catch(() => {})
          connectedCount++
        }
      } catch (err) {
        console.error(`[google-ads-oauth] failed to save customer ${acc.customerId}:`, err instanceof Error ? err.message : err)
      }
    }

    return redirectBack(req, workspaceId, {
      ok: true,
      connectedAccounts: connectedCount,
      updatedAccounts: updatedCount,
    })
  } catch (err) {
    console.error('[google-ads-oauth] callback failed:', err instanceof Error ? err.message : err)
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
  return new URL('/api/google-ads/oauth/callback', base).toString()
}

type VerifiedState = { ok: true; workspaceId: string } | { ok: false; reason: string }

function verifyOAuthState(state: string): VerifiedState {
  const stateSecret = process.env.GOOGLE_OAUTH_STATE_SECRET ?? process.env.META_OAUTH_STATE_SECRET
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
  if (parsed.kind !== 'google_ads') return { ok: false, reason: 'state kind mismatch' }
  if (typeof parsed.ts !== 'number' || Date.now() - parsed.ts > STATE_MAX_AGE_MS) {
    return { ok: false, reason: 'state expired' }
  }
  return { ok: true, workspaceId: parsed.workspaceId }
}

async function describeUser(accessToken: string): Promise<{ email?: string } | null> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return null
  const data = (await res.json()) as { email?: string }
  return data
}

/**
 * Returns customer IDs the OAuth user can access, stripped of the
 * "customers/" resource prefix and stored unhyphenated.
 */
async function listAccessibleCustomers(p: {
  accessToken: string
  developerToken: string
}): Promise<string[]> {
  const res = await fetch('https://googleads.googleapis.com/v20/customers:listAccessibleCustomers', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${p.accessToken}`,
      'developer-token': p.developerToken,
    },
  })
  if (!res.ok) {
    throw new Error(`listAccessibleCustomers failed: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as { resourceNames?: string[] }
  return (data.resourceNames ?? []).map((rn) => rn.replace(/^customers\//, ''))
}

/**
 * Calls customers/<id>/googleAds:searchStream for the customer's
 * descriptive_name + currency_code. Returns null on failure (manager
 * accounts often need a login-customer-id header that we don't pass —
 * that's expected and not fatal).
 */
async function describeCustomer(p: {
  customerId: string
  accessToken: string
  developerToken: string
}): Promise<{ descriptiveName?: string; currencyCode?: string } | null> {
  const url = `https://googleads.googleapis.com/v20/customers/${p.customerId}/googleAds:searchStream`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${p.accessToken}`,
      'developer-token': p.developerToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: 'SELECT customer.descriptive_name, customer.currency_code FROM customer LIMIT 1',
    }),
  })
  if (!res.ok) return null
  const data = (await res.json()) as Array<{
    results?: Array<{ customer?: { descriptiveName?: string; currencyCode?: string } }>
  }>
  const row = data?.[0]?.results?.[0]?.customer
  if (!row) return null
  return { descriptiveName: row.descriptiveName, currencyCode: row.currencyCode }
}

/** Formats an unhyphenated 10-digit customer ID into 123-456-7890. */
function formatCustomerId(id: string): string {
  if (!/^\d{10}$/.test(id)) return id
  return `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}`
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
  dest.searchParams.set('google_ads', result.ok ? 'connected' : 'error')
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
