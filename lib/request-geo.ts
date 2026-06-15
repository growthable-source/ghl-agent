/**
 * Coarse visitor geolocation from Vercel's edge headers.
 *
 * Every request to our widget API passes through Vercel's edge network,
 * which stamps the caller's approximate location onto these headers — so
 * we get city-level geo for free, no external API, no key, no rate limit.
 * Returns nulls off-Vercel (local dev) or when the edge can't resolve a
 * location.
 *
 * Headers: https://vercel.com/docs/edge-network/headers#x-vercel-ip-*
 */

export interface RequestGeo {
  country: string | null   // ISO-3166-1 alpha-2
  city: string | null
  latitude: number | null
  longitude: number | null
}

export function getRequestGeo(headers: Headers): RequestGeo {
  const country = headers.get('x-vercel-ip-country')?.trim() || null
  // City is URL-encoded by Vercel (e.g. "San%20Francisco").
  const rawCity = headers.get('x-vercel-ip-city')
  let city: string | null = null
  if (rawCity) {
    try { city = decodeURIComponent(rawCity).slice(0, 120) } catch { city = rawCity.slice(0, 120) }
  }
  const lat = parseFloat(headers.get('x-vercel-ip-latitude') ?? '')
  const lng = parseFloat(headers.get('x-vercel-ip-longitude') ?? '')
  return {
    country: country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null,
    city,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
  }
}

/** True when the headers carried any usable geo (so we only write when we have something). */
export function hasGeo(g: RequestGeo): boolean {
  return g.country != null || (g.latitude != null && g.longitude != null)
}
