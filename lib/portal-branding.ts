/**
 * Portal whitelabel host → branding resolution.
 *
 * The portal-facing login page and layout call getPortalBranding(host)
 * to show the customer's logo/name/accent BEFORE login, when a visitor
 * arrives on a custom domain. After login the layout brands from the
 * session instead. The pure normalizers are unit-tested; the DB lookup
 * is a thin wrapper.
 */

import { db } from '@/lib/db'

export interface PortalBranding {
  id: string
  name: string
  logoUrl: string | null
  primaryColor: string | null
}

/** Incoming request Host → bare lowercase hostname (no port). */
export function normalizeHost(host: string | null | undefined): string | null {
  if (!host) return null
  const bare = host.trim().toLowerCase().split(':')[0]
  return bare || null
}

export { normalizeCustomDomain } from '@/lib/domains/hostname'

/** Look up the portal that owns this request host (custom domain). */
export async function getPortalBranding(host: string | null | undefined): Promise<PortalBranding | null> {
  const normalized = normalizeHost(host)
  if (!normalized) return null
  const portal = await db.portal.findUnique({
    where: { customDomain: normalized },
    select: { id: true, name: true, logoUrl: true, primaryColor: true, isActive: true },
  })
  if (!portal || !portal.isActive) return null
  return { id: portal.id, name: portal.name, logoUrl: portal.logoUrl, primaryColor: portal.primaryColor }
}
