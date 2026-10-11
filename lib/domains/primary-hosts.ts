/**
 * Hosts that ARE the Xovera app. Any other host reaching the server is a
 * customer custom domain (portal or workspace white-label) and is held to
 * the public-surface allowlist in middleware (lib/domains/hostname.ts).
 * Pure + env-derived so Edge middleware and Node handlers share one
 * definition.
 *
 * This list MUST cover every host the deployment legitimately answers on,
 * or middleware will 404 the dashboard/auth/webhooks there:
 *   - our own apex domains and ANY subdomain of them (app., www., widget.,
 *     staging…) — OWN_DOMAINS below. Customers can never claim these
 *     (reserved in validateWorkspaceDomain).
 *   - app.voxility.ai: the same project is reached on voxility.ai too
 *     (see lib/auth-host.ts).
 *   - *.vercel.app previews and localhost.
 *   - PRIMARY_HOSTS (comma-separated env): extra hosts, e.g. the hostnames
 *     of other runtime projects that main proxies to (a proxied request
 *     arrives carrying the runtime project's OWN host).
 *   - NEXT_PUBLIC_SITE_URL / NEXT_PUBLIC_APP_URL hosts.
 */

/** Apex domains we own; the apex and every subdomain count as primary. */
export const OWN_DOMAINS: readonly string[] = ['xovera.io', 'voxility.ai']

function hostnameOf(url: string | undefined): string | null {
  if (!url) return null
  try { return new URL(url).hostname.toLowerCase() } catch { return null }
}

export const PRIMARY_HOSTS: ReadonlySet<string> = new Set(
  [
    hostnameOf(process.env.NEXT_PUBLIC_SITE_URL),
    hostnameOf(process.env.NEXT_PUBLIC_APP_URL),
    'localhost',
    '127.0.0.1',
    ...(process.env.PRIMARY_HOSTS || '').split(',').map(h => h.trim().toLowerCase()),
  ].filter((h): h is string => !!h),
)

export function isPrimaryHost(host: string): boolean {
  return (
    PRIMARY_HOSTS.has(host) ||
    host.endsWith('.vercel.app') ||
    OWN_DOMAINS.some(d => host === d || host.endsWith(`.${d}`))
  )
}
