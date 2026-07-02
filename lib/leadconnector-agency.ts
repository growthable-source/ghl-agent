/**
 * Agency-level LeadConnector connection.
 *
 * A SEPARATE marketplace app from the per-location install infra
 * (app/api/auth/callback + lib/token-store): this one installs at the
 * agency (Company) level, once per workspace, purely to enumerate the
 * agency's locations for per-location widget control. Different client
 * id/secret on purpose — one workspace contains many widgets, and this
 * connection is workspace-scoped, not location-scoped.
 */

import { db } from '@/lib/db'
import { planAgencyLocationSync, type FetchedAgencyLocation } from '@/lib/agency-location-sync'

const API_BASE = 'https://services.leadconnectorhq.com'
const API_VERSION = '2021-07-28'
export const AGENCY_OAUTH_SCOPES = 'locations.readonly companies.readonly'

export function agencyOAuthConfigured(): boolean {
  return !!(process.env.LEADCONNECTOR_AGENCY_CLIENT_ID && process.env.LEADCONNECTOR_AGENCY_CLIENT_SECRET)
}

interface AgencyTokenResponse {
  access_token: string
  refresh_token: string
  expires_in?: number
  scope?: string | string[]
  companyId?: string
  userType?: string
}

async function tokenRequest(params: Record<string, string>): Promise<AgencyTokenResponse> {
  const body = new URLSearchParams({
    client_id: process.env.LEADCONNECTOR_AGENCY_CLIENT_ID!,
    client_secret: process.env.LEADCONNECTOR_AGENCY_CLIENT_SECRET!,
    user_type: 'Company',
    ...params,
  })
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) throw new Error(`Agency token request failed (${res.status}): ${await res.text()}`)
  return res.json()
}

export async function exchangeAgencyCode(code: string): Promise<AgencyTokenResponse> {
  return tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: `${process.env.APP_URL}/api/auth/leadconnector-agency/callback`,
  })
}

/**
 * Returns a currently-valid access token for the connection, refreshing
 * (and persisting) if it expires within 5 minutes. Stamps
 * tokenRefreshFailedAt on refresh failure so the UI can show a
 * reconnect banner; clears it on success.
 */
export async function getAgencyAccessToken(connectionId: string): Promise<string> {
  const conn = await db.agencyConnection.findUniqueOrThrow({
    where: { id: connectionId },
    select: { accessToken: true, refreshToken: true, expiresAt: true },
  })
  if (conn.expiresAt.getTime() - Date.now() > 5 * 60 * 1000) return conn.accessToken
  try {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: conn.refreshToken })
    await db.agencyConnection.update({
      where: { id: connectionId },
      data: {
        accessToken: t.access_token,
        refreshToken: t.refresh_token ?? conn.refreshToken,
        expiresAt: new Date(Date.now() + (t.expires_in ?? 86400) * 1000),
        tokenRefreshFailedAt: null,
      },
    })
    return t.access_token
  } catch (err) {
    await db.agencyConnection.update({
      where: { id: connectionId },
      data: { tokenRefreshFailedAt: new Date() },
    }).catch(() => {})
    throw err
  }
}

/** Paginated GET /locations/search for every location under the agency. */
export async function listAgencyLocations(accessToken: string, companyId: string): Promise<FetchedAgencyLocation[]> {
  const out: FetchedAgencyLocation[] = []
  const limit = 100
  let skip = 0
  // Hard cap of 100 pages (10k locations) so a pathological API response
  // can't loop forever.
  for (let page = 0; page < 100; page++) {
    const url = `${API_BASE}/locations/search?companyId=${encodeURIComponent(companyId)}&limit=${limit}&skip=${skip}`
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Version: API_VERSION, Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`locations/search failed (${res.status}): ${await res.text()}`)
    const data = await res.json()
    const batch: any[] = Array.isArray(data?.locations) ? data.locations : []
    for (const l of batch) {
      if (!l?._id && !l?.id) continue
      out.push({
        locationId: String(l._id ?? l.id),
        name: String(l.name ?? 'Unnamed location'),
        city: l.city ?? null,
        state: l.state ?? null,
        country: l.country ?? null,
        email: l.email ?? null,
        phone: l.phone ?? null,
      })
    }
    if (batch.length < limit) break
    skip += limit
  }
  return out
}

/**
 * Fetch the agency's locations and reconcile AgencyLocation rows.
 * Upsert-only + removedAt stamping — never deletes, so widgetEnabled
 * toggles survive a location being removed and re-added.
 */
export async function syncAgencyLocations(connectionId: string): Promise<{ total: number; removed: number }> {
  const conn = await db.agencyConnection.findUniqueOrThrow({
    where: { id: connectionId },
    select: { id: true, companyId: true },
  })
  const token = await getAgencyAccessToken(connectionId)
  const fetched = await listAgencyLocations(token, conn.companyId)
  const existing = await db.agencyLocation.findMany({
    where: { connectionId },
    select: { locationId: true, removedAt: true },
  })
  const plan = planAgencyLocationSync(existing, fetched)
  const now = new Date()
  for (const loc of plan.upserts) {
    const snapshot = {
      name: loc.name, city: loc.city, state: loc.state, country: loc.country,
      email: loc.email, phone: loc.phone, lastSyncedAt: now, removedAt: null,
    }
    await db.agencyLocation.upsert({
      where: { connectionId_locationId: { connectionId, locationId: loc.locationId } },
      create: { connectionId, locationId: loc.locationId, ...snapshot },
      update: snapshot,
    })
  }
  if (plan.markRemoved.length > 0) {
    await db.agencyLocation.updateMany({
      where: { connectionId, locationId: { in: plan.markRemoved } },
      data: { removedAt: now, lastSyncedAt: now },
    })
  }
  return { total: plan.upserts.length, removed: plan.markRemoved.length }
}
