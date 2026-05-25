/**
 * Snapshot fetcher for marketplace install metadata.
 *
 * Called from the OAuth callback after token exchange. Pulls the
 * installing user's profile, their sub-account (Location) details, and
 * — if the OAuth grant permits — the agency Company. Returns whatever
 * succeeded; the caller persists the result regardless of which fields
 * came back null.
 *
 * Each endpoint is wrapped in its own try/catch so a 403 on Companies
 * (the OAuth scope `companies.readonly` typically only ships with
 * agency-level installs) doesn't sink the location + user fetches.
 *
 * The `Authorization: Bearer <accessToken>` + `Version: 2021-07-28`
 * pair matches the convention used by lib/crm/ghl/adapter.ts. Keeping
 * this fetcher separate from the adapter because:
 *   - it's invoked exactly once per install, not on every runtime call
 *   - it doesn't need CrmAdapter's reactive token refresh — the token
 *     we received from OAuth seconds ago is guaranteed valid
 */

const BASE_URL = 'https://services.leadconnectorhq.com'
const API_VERSION = '2021-07-28'

export interface FetchedLocation {
  id?: string
  name?: string
  email?: string
  phone?: string
  website?: string
  address?: string
  city?: string
  state?: string
  country?: string
  timezone?: string
}

export interface FetchedCompany {
  id?: string
  name?: string
  email?: string
  phone?: string
  website?: string
}

export interface FetchedUser {
  id?: string
  name?: string
  email?: string
  phone?: string
  role?: string
}

export interface InstallSnapshot {
  location: FetchedLocation | null
  company: FetchedCompany | null
  user: FetchedUser | null
  // Echoes everything we got from GHL so future schema additions can be
  // backfilled without re-calling. Keys: 'location', 'company', 'user',
  // each holding the raw response body or null on failure.
  raw: Record<string, unknown>
}

async function ghlGet<T>(accessToken: string, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: API_VERSION,
        Accept: 'application/json',
      },
    })
    if (!res.ok) {
      // 403 on companies/* is expected for non-agency installs; just
      // log and return null so the caller can persist what it has.
      const body = await res.text().catch(() => '')
      console.warn(`[install-fetcher] GET ${path} → ${res.status}: ${body.slice(0, 200)}`)
      return null
    }
    return (await res.json()) as T
  } catch (err: any) {
    console.warn(`[install-fetcher] GET ${path} threw:`, err?.message)
    return null
  }
}

export async function fetchInstallSnapshot(opts: {
  accessToken: string
  locationId?: string | null
  companyId?: string | null
  userId?: string | null
}): Promise<InstallSnapshot> {
  const { accessToken, locationId, companyId, userId } = opts

  // Three fetches in parallel — typical total latency ~300ms. If any
  // hangs we still serve the response within timeout because each call
  // is bounded by the platform's outbound HTTP timeout.
  const [locationRes, companyRes, userRes] = await Promise.all([
    locationId
      ? ghlGet<{ location?: Record<string, any> }>(accessToken, `/locations/${locationId}`)
      : Promise.resolve(null),
    companyId
      ? ghlGet<{ company?: Record<string, any> }>(accessToken, `/companies/${companyId}`)
      : Promise.resolve(null),
    userId
      ? ghlGet<{ user?: Record<string, any> }>(accessToken, `/users/${userId}`)
      : Promise.resolve(null),
  ])

  // Field names follow GHL's REST shape — defensive optional-chains
  // because the schema has drifted over time and some accounts return
  // slightly different field casings or nesting.
  const loc = locationRes?.location ?? null
  const location: FetchedLocation | null = loc
    ? {
        id: loc.id,
        name: loc.name ?? loc.businessName,
        email: loc.email,
        phone: loc.phone,
        website: loc.website,
        address: loc.address ?? loc.address1,
        city: loc.city,
        state: loc.state ?? loc.province,
        country: loc.country,
        timezone: loc.timezone,
      }
    : null

  const co = companyRes?.company ?? null
  const company: FetchedCompany | null = co
    ? {
        id: co.id,
        name: co.name ?? co.companyName ?? co.businessName,
        email: co.email,
        phone: co.phone,
        website: co.website ?? co.domain,
      }
    : null

  const u = userRes?.user ?? null
  const user: FetchedUser | null = u
    ? {
        id: u.id,
        name: u.name ?? ([u.firstName, u.lastName].filter(Boolean).join(' ') || undefined),
        email: u.email,
        phone: u.phone,
        role: u.role ?? u.type,
      }
    : null

  return {
    location,
    company,
    user,
    raw: {
      location: locationRes ?? null,
      company: companyRes ?? null,
      user: userRes ?? null,
    },
  }
}
