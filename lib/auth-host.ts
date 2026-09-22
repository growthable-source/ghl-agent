/**
 * Host for Auth.js absolute URLs (signin, callback, OAuth redirect_uri).
 *
 * next-auth v5's stock route handler rewrites every request to
 * `AUTH_URL ?? NEXTAUTH_URL` (`reqWithEnvURL`) before Auth.js builds
 * those URLs. This deployment is one Vercel project reached on more
 * than one public host (app.xovera.io and app.voxility.ai). Pinning
 * the origin makes Google's redirect_uri one host while the PKCE
 * cookie is stored on the host the browser actually called, and the
 * callback then fails.
 *
 * `trustHost: true` is already set. These helpers keep the incoming
 * request URL and do not consult AUTH_URL, NEXTAUTH_URL, or APP_URL.
 * APP_URL stays the canonical link base for email and CRM redirects;
 * it is not an Auth.js setting.
 */

export function envPresence(value: string | undefined): 'set' | 'MISSING' {
  return typeof value === 'string' && value.trim().length > 0 ? 'set' : 'MISSING'
}

export function authRequestHref(input: {
  requestHref: string
  /** Ignored. Present so callers cannot quietly thread a pinned origin in. */
  authUrl?: string
  /** Ignored. Legacy alias of AUTH_URL. */
  nextAuthUrl?: string
  /** Ignored. Canonical app link base, not an Auth.js host. */
  appUrl?: string
}): string {
  return new URL(input.requestHref).href
}
