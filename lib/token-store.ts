/**
 * Token Store
 * 
 * In production, replace the in-memory Map with your database of choice.
 * Each locationId gets its own token set.
 * 
 * For Vercel/Railway: use Upstash Redis (free tier covers this well)
 * For self-hosted: use Postgres or SQLite
 */

import type { StoredTokens, OAuthTokenResponse } from '@/types'

// ─── In-memory store (swap for DB in production) ───────────────────────────
// Key: locationId | companyId
const tokenStore = new Map<string, StoredTokens>()

export function saveTokens(key: string, data: OAuthTokenResponse): StoredTokens {
  const stored: StoredTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    refreshTokenId: data.refreshTokenId,
    userType: data.userType,
    companyId: data.companyId,
    locationId: data.locationId,
    userId: data.userId,
    scope: data.scope,
    // expires_in is in seconds, store as ms timestamp with 5-min buffer
    expiresAt: Date.now() + (data.expires_in - 300) * 1000,
    installedAt: Date.now(),
  }
  tokenStore.set(key, stored)
  return stored
}

export function getTokens(key: string): StoredTokens | null {
  return tokenStore.get(key) ?? null
}

export function deleteTokens(key: string): void {
  tokenStore.delete(key)
}

export function isExpired(tokens: StoredTokens): boolean {
  return Date.now() >= tokens.expiresAt
}

export function listAllLocations(): string[] {
  return Array.from(tokenStore.keys())
}

// ─── Token refresh ─────────────────────────────────────────────────────────

export async function refreshAccessToken(key: string): Promise<StoredTokens | null> {
  const existing = getTokens(key)
  if (!existing) return null

  try {
    const params = new URLSearchParams({
      client_id: process.env.OAUTH_CLIENT_ID!,
      client_secret: process.env.OAUTH_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: existing.refreshToken,
      user_type: existing.userType,
      redirect_uri: `${process.env.APP_URL}/api/auth/callback`,
    })

    const res = await fetch('https://services.leadconnectorhq.com/oauth/token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    if (!res.ok) {
      console.error('[TokenStore] Refresh failed:', await res.text())
      return null
    }

    const data: OAuthTokenResponse = await res.json()
    return saveTokens(key, data)
  } catch (err) {
    console.error('[TokenStore] Refresh error:', err)
    return null
  }
}

// ─── Get a valid access token (auto-refreshes if needed) ───────────────────

export async function getValidAccessToken(key: string): Promise<string | null> {
  let tokens = getTokens(key)
  if (!tokens) return null
  if (isExpired(tokens)) {
    tokens = await refreshAccessToken(key)
  }
  return tokens?.accessToken ?? null
}

// ─── Upgrade: get a Location token from an Agency token ────────────────────

export async function getLocationToken(
  companyId: string,
  locationId: string
): Promise<string | null> {
  const agencyToken = await getValidAccessToken(companyId)
  if (!agencyToken) return null

  try {
    const res = await fetch('https://services.leadconnectorhq.com/oauth/locationToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Version': '2021-07-28',
        'Authorization': `Bearer ${agencyToken}`,
      },
      body: JSON.stringify({ companyId, locationId }),
    })

    if (!res.ok) return null
    const data: OAuthTokenResponse = await res.json()
    saveTokens(locationId, data)
    return data.access_token
  } catch (err) {
    console.error('[TokenStore] Location token error:', err)
    return null
  }
}
