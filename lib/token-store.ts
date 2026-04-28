/**
 * Token Store — Prisma/Postgres backed.
 *
 * Two bugs have historically caused "GHL connection keeps dropping" reports:
 *
 * 1. THUNDERING HERD ON REFRESH.
 *    When an access token expires, every concurrent request that sees the
 *    expired token calls refreshAccessToken simultaneously. Each uses the
 *    same refresh_token value. GHL's OAuth server (like most) rotates the
 *    refresh_token on successful refresh — the first request gets a new
 *    pair, every subsequent request using the old refresh_token is
 *    rejected and, worse, GHL may invalidate the whole session.
 *
 *    Fix: single-flight pattern. A promise cache keyed by `key` ensures
 *    at most one refresh call for a given location is in flight at a
 *    time; concurrent callers await the same promise.
 *
 * 2. NO RETRY ON TRANSIENT FAILURES.
 *    A single 5xx from GHL, a network hiccup, or a brief timeout caused
 *    the token to be treated as "gone" and required the user to manually
 *    reconnect. Transient failures should retry with backoff; only 4xx
 *    responses (invalid_grant, etc.) mean the token is actually dead.
 *
 *    Fix: up to 3 attempts with exponential backoff for any
 *    network/5xx/timeout error. 400/401 from the refresh endpoint short-
 *    circuits immediately — re-auth is genuinely needed.
 */

import { db } from './db'
import type { StoredTokens, OAuthTokenResponse } from '@/types'

const REFRESH_TIMEOUT_MS = 15_000
const MAX_REFRESH_ATTEMPTS = 3
const REFRESH_BACKOFF_BASE_MS = 400       // first retry after ~400ms, then ~800ms, then ~1600ms

// Module-level promise map keyed by token key (locationId / companyId).
// Entries are removed after the promise settles. Module state is fine —
// Vercel's serverless functions share the same process across concurrent
// requests within a single invocation, and across cold starts a fresh
// Map means the worst case is a single duplicate refresh on the first
// request after a new instance spins up.
const refreshInFlight = new Map<string, Promise<StoredTokens | null>>()

export async function saveTokens(key: string, data: OAuthTokenResponse): Promise<StoredTokens> {
  const expiresAt = new Date(Date.now() + (data.expires_in - 300) * 1000)

  const location = await db.location.upsert({
    where: { id: key },
    create: {
      id: key,
      companyId: data.companyId,
      userId: data.userId,
      userType: data.userType,
      scope: data.scope,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      refreshTokenId: data.refreshTokenId,
      expiresAt,
    },
    update: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      refreshTokenId: data.refreshTokenId,
      expiresAt,
      scope: data.scope,
    },
  })

  return locationToStoredTokens(location)
}

export async function getTokens(key: string): Promise<StoredTokens | null> {
  const location = await db.location.findUnique({ where: { id: key } })
  if (!location) return null
  return locationToStoredTokens(location)
}

export async function deleteTokens(key: string): Promise<void> {
  await db.location.delete({ where: { id: key } }).catch(() => {})
}

export function isExpired(tokens: StoredTokens): boolean {
  return Date.now() >= tokens.expiresAt
}

export async function listAllLocations(): Promise<string[]> {
  const locations = await db.location.findMany({ select: { id: true } })
  return locations.map((l) => l.id)
}

/**
 * Refresh the access token for the given key, with single-flight dedup
 * and retry on transient failures. Returns the updated tokens on success,
 * null on permanent failure.
 *
 * Safe to call concurrently — if a refresh is already in flight for the
 * same key, this awaits the in-flight promise rather than starting a
 * second refresh.
 */
export async function refreshAccessToken(key: string): Promise<StoredTokens | null> {
  // Single-flight: if this key is already refreshing, share the result.
  const existing = refreshInFlight.get(key)
  if (existing) return existing

  const promise = refreshImpl(key)
  refreshInFlight.set(key, promise)
  try {
    return await promise
  } finally {
    refreshInFlight.delete(key)
  }
}

async function refreshImpl(key: string): Promise<StoredTokens | null> {
  // Placeholder locations exist purely as FK targets for agents created
  // before a real GHL OAuth connection — they have empty refresh tokens
  // and crmProvider='none'. Hitting GHL's /oauth/token with empty values
  // is a guaranteed 422; skip outright and stop retrying.
  if (key.startsWith('placeholder:')) return null

  const tokens = await getTokens(key)
  if (!tokens) {
    console.warn(`[TokenStore] refreshAccessToken called for unknown key "${key}" — no tokens in DB`)
    return null
  }
  // Same defense for any non-placeholder location whose tokens are
  // empty / dead. Better to surface a reconnect than hammer GHL with
  // a refresh that can't possibly succeed.
  if (!tokens.refreshToken || !tokens.userType) {
    console.warn(`[TokenStore] Skipping refresh for "${key}" — refresh_token or user_type is empty (reconnect required)`)
    return null
  }

  let lastError: string | null = null

  for (let attempt = 1; attempt <= MAX_REFRESH_ATTEMPTS; attempt++) {
    // Build the refresh request for each attempt in case the stored
    // refresh_token changed between attempts (shouldn't, but defensive).
    const params = new URLSearchParams({
      client_id: process.env.OAUTH_CLIENT_ID!,
      client_secret: process.env.OAUTH_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      user_type: tokens.userType,
      redirect_uri: `${process.env.APP_URL}/api/auth/callback`,
    })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS)

    try {
      const res = await fetch('https://services.leadconnectorhq.com/oauth/token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      // 400 / 401 / 403 are all "re-auth needed" from GHL. No point
      // retrying these — the refresh token is dead / permissions
      // revoked. Return null so the caller surfaces a reconnect prompt.
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        const body = await res.text().catch(() => '')
        console.error(
          `[TokenStore] ❌ Refresh rejected by GHL for "${key}" (HTTP ${res.status}). ` +
          `Refresh token is invalid — user must reconnect. Body: ${body.slice(0, 300)}`,
        )
        return null
      }

      if (!res.ok) {
        // 5xx or other transient-looking error. Retry with backoff.
        const body = await res.text().catch(() => '')
        lastError = `HTTP ${res.status}: ${body.slice(0, 200)}`
        console.warn(
          `[TokenStore] ⚠ Refresh attempt ${attempt}/${MAX_REFRESH_ATTEMPTS} for "${key}" failed: ${lastError}`,
        )
        if (attempt < MAX_REFRESH_ATTEMPTS) {
          await sleep(REFRESH_BACKOFF_BASE_MS * 2 ** (attempt - 1))
          continue
        }
        console.error(
          `[TokenStore] ❌ Refresh exhausted retries for "${key}" after ${MAX_REFRESH_ATTEMPTS} attempts. ` +
          `Last error: ${lastError}. Old tokens preserved — next request will retry.`,
        )
        return null
      }

      // Success. Save the new pair (potentially rotated refresh_token).
      const data: OAuthTokenResponse = await res.json()
      const saved = await saveTokens(key, data)
      if (attempt > 1) {
        console.log(`[TokenStore] ✓ Refreshed "${key}" on attempt ${attempt}`)
      } else {
        console.log(`[TokenStore] ✓ Refreshed "${key}"`)
      }
      return saved
    } catch (err: any) {
      clearTimeout(timeoutId)
      const isAbort = err?.name === 'AbortError'
      lastError = isAbort ? `timeout after ${REFRESH_TIMEOUT_MS}ms` : (err?.message ?? 'unknown')
      console.warn(
        `[TokenStore] ⚠ Refresh attempt ${attempt}/${MAX_REFRESH_ATTEMPTS} for "${key}" threw: ${lastError}`,
      )
      if (attempt < MAX_REFRESH_ATTEMPTS) {
        await sleep(REFRESH_BACKOFF_BASE_MS * 2 ** (attempt - 1))
        continue
      }
      console.error(
        `[TokenStore] ❌ Refresh exhausted retries for "${key}" on exceptions. Last: ${lastError}.`,
      )
      return null
    }
  }

  return null
}

/**
 * Get a valid access token, refreshing if expired. The core helper every
 * CRM adapter ultimately calls.
 *
 * Note: "expired" uses the saved expiresAt which already bakes in a 5-min
 * safety margin (saveTokens subtracts 300 from expires_in). So a fresh
 * token is treated as expired ~5 minutes before GHL actually invalidates
 * it, leaving room for the refresh round-trip to complete before a real
 * 401 could hit.
 */
export async function getValidAccessToken(key: string): Promise<string | null> {
  let tokens = await getTokens(key)
  if (!tokens) return null
  if (isExpired(tokens)) {
    tokens = await refreshAccessToken(key)
  }
  return tokens?.accessToken ?? null
}

export async function getLocationToken(
  companyId: string,
  locationId: string,
): Promise<string | null> {
  const agencyToken = await getValidAccessToken(companyId)
  if (!agencyToken) return null

  try {
    const res = await fetch('https://services.leadconnectorhq.com/oauth/locationToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Version: '2021-07-28',
        Authorization: `Bearer ${agencyToken}`,
      },
      body: JSON.stringify({ companyId, locationId }),
    })

    if (!res.ok) return null
    const data: OAuthTokenResponse = await res.json()
    await saveTokens(locationId, data)
    return data.access_token
  } catch (err) {
    console.error('[TokenStore] Location token error:', err)
    return null
  }
}

// ─── Internal helpers ──────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function locationToStoredTokens(location: {
  id: string
  accessToken: string
  refreshToken: string
  refreshTokenId: string
  userType: string
  companyId: string
  userId: string
  scope: string
  expiresAt: Date
  installedAt: Date
}): StoredTokens {
  return {
    accessToken: location.accessToken,
    refreshToken: location.refreshToken,
    refreshTokenId: location.refreshTokenId,
    userType: location.userType as 'Location' | 'Company',
    companyId: location.companyId,
    locationId: location.id,
    userId: location.userId,
    scope: location.scope,
    expiresAt: location.expiresAt.getTime(),
    installedAt: location.installedAt.getTime(),
  }
}
