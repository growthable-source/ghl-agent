/**
 * Token Store — Prisma/Postgres backed
 * Replaces the in-memory Map. Same public API.
 */

import { db } from './db'
import type { StoredTokens, OAuthTokenResponse } from '@/types'

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

export async function refreshAccessToken(key: string): Promise<StoredTokens | null> {
  const existing = await getTokens(key)
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
        Accept: 'application/json',
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
  locationId: string
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

// ─── Internal helper ───────────────────────────────────────────────────────

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
