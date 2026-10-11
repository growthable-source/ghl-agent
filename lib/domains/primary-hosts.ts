/**
 * Hosts that ARE the Xovera app (marketing + dashboard). Any other host
 * reaching the server is a customer custom domain (portal or workspace
 * white-label). Pure + env-derived so Edge middleware and Node route
 * handlers share one definition.
 */

function hostnameOf(url: string | undefined): string | null {
  if (!url) return null
  try { return new URL(url).hostname.toLowerCase() } catch { return null }
}

export const PRIMARY_HOSTS: ReadonlySet<string> = new Set(
  [
    hostnameOf(process.env.NEXT_PUBLIC_SITE_URL),
    hostnameOf(process.env.NEXT_PUBLIC_APP_URL),
    'xovera.io',
    'app.xovera.io',
    'localhost',
    '127.0.0.1',
  ].filter((h): h is string => !!h),
)

export function isPrimaryHost(host: string): boolean {
  return PRIMARY_HOSTS.has(host) || host.endsWith('.vercel.app')
}
