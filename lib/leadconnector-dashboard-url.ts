/**
 * Whitelabel LeadConnector dashboard URL builder.
 *
 * Every LeadConnector sub-account has a dashboard URL of the shape
 * `<whitelabel-host>/v2/location/<locationId>`. The whitelabel host
 * depends on which reseller the install came from — Voxility's own
 * deploy uses `app.voxility.ai`, but the same code can ship under any
 * agency's branded subdomain.
 *
 * We don't try to derive the host from the install payload; the
 * Marketplace API doesn't return it. Instead, the deployment's own
 * whitelabel host is read from `LEADCONNECTOR_DASHBOARD_BASE_URL`,
 * falling back to `https://app.voxility.ai`. Override per environment
 * if the same code ships behind a different agency brand.
 *
 * Why a wrapper instead of inlining the template: we use this from at
 * least two UI surfaces (agent cards on /agents, the identity strip
 * on /integrations) plus future admin tooling, and the URL shape is
 * the kind of thing that quietly changes when LC rolls out a new
 * dashboard route. One function, one place to update.
 */

const DEFAULT_BASE = 'https://app.voxility.ai'

/**
 * Returns a clickable dashboard URL for a Location, or null when the
 * Location is a synthetic native:/placeholder: row (no external CRM
 * to link to) or a HubSpot install (HubSpot uses a different URL
 * shape; not in scope here — pass through and let the caller decide
 * whether to link).
 */
export function getLocationDashboardUrl(
  locationId: string,
  provider: string | null | undefined = 'ghl',
): string | null {
  if (!locationId) return null
  if (locationId.startsWith('native:')) return null
  if (locationId.startsWith('placeholder:')) return null
  // Only LeadConnector/GHL has the /v2/location/<id> shape. HubSpot
  // dashboard URLs key off portalId, not locationId, so we abstain.
  if (provider && provider !== 'ghl') return null

  const base = (process.env.LEADCONNECTOR_DASHBOARD_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '')
  return `${base}/v2/location/${encodeURIComponent(locationId)}`
}
