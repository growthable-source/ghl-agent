import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { EMBED_SESSION_COOKIE, REGULAR_SESSION_COOKIE } from '@/lib/embed-session'

/**
 * Primary app hosts — the marketing site + dashboard. Any OTHER host
 * that reaches our server is a portal custom domain (the dashboard's
 * iframe-embedding whitelabel domains never route requests here; their
 * iframe src points at the primary host). Derived from the public URL
 * envs, with localhost + *.vercel.app for dev/preview.
 */
function hostnameOf(url: string | undefined): string | null {
  if (!url) return null
  try { return new URL(url).hostname.toLowerCase() } catch { return null }
}
const PRIMARY_HOSTS = new Set(
  [
    hostnameOf(process.env.NEXT_PUBLIC_SITE_URL),
    hostnameOf(process.env.NEXT_PUBLIC_APP_URL),
    'voxility.ai',
    'app.voxility.ai',
    'localhost',
    '127.0.0.1',
  ].filter((h): h is string => !!h),
)
function isPrimaryHost(host: string): boolean {
  return PRIMARY_HOSTS.has(host) || host.endsWith('.vercel.app')
}

/**
 * Two responsibilities, both centralised here so the rest of the
 * codebase doesn't need to know they exist:
 *
 *   1. **Dashboard auth gate.** Redirect unauthenticated users hitting
 *      /dashboard/* to /login, the way it's worked for a while.
 *
 *   2. **Embed-cookie promotion.** When a request carries the
 *      __Secure-voxility-embed-session cookie but NOT the regular
 *      __Secure-authjs.session-token, copy the value onto the regular
 *      cookie name on the request side so downstream `auth()` calls
 *      resolve a valid session. Request-scoped — the browser never
 *      sees the rename, the cookies remain logically separate.
 *
 *      Why the rewrite instead of two-cookie auth() everywhere: every
 *      server component, server action, and API route in the app
 *      currently calls `auth()` from lib/auth.ts. NextAuth v5's
 *      session resolution is hard-bound to one cookie name. Promoting
 *      in middleware means no caller has to change.
 */
export function middleware(request: NextRequest) {
  const regular = request.cookies.get(REGULAR_SESSION_COOKIE)
  const embed = request.cookies.get(EMBED_SESSION_COOKIE)

  // Also accept the non-prefixed cookie name (dev only — production
  // always uses the __Secure- prefix). On prod this branch is a no-op.
  const regularUnprefixed = request.cookies.get('authjs.session-token')

  // Promote the embed cookie onto the regular cookie for the request
  // that's about to be forwarded. The DB row backing this sessionToken
  // is identical regardless of which cookie carried it.
  if (!regular && !regularUnprefixed && embed) {
    request.cookies.set(REGULAR_SESSION_COOKIE, embed.value)
  }

  // Whitelabel routing: on a portal custom domain, the root path serves
  // the portal (not the Voxility marketing site). Host-only check — no
  // DB lookup (Edge); the portal pages resolve branding by host. Only
  // the root is rewritten; /portal/*, /api/*, /_next/* pass through and
  // already work on the custom domain.
  const host = (request.headers.get('host') || '').toLowerCase().split(':')[0]
  if (request.nextUrl.pathname === '/' && host && !isPrimaryHost(host)) {
    const url = request.nextUrl.clone()
    url.pathname = '/portal'
    return NextResponse.rewrite(url, { request })
  }

  // Only /dashboard/* requires a session; the API routes the matcher
  // covers do their own per-route auth (often workspace-scoped) and
  // we don't want to short-circuit them here.
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    const hasAnySession = !!(regular || regularUnprefixed || embed)
    if (!hasAnySession) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('callbackUrl', request.nextUrl.pathname)
      return NextResponse.redirect(loginUrl)
    }
    // Note: we DON'T block /dashboard/new on the embed cookie. The
    // cookie is SameSite=None and travels in regular browser tabs
    // too, so any user who's ever tested in the iframe would be
    // permanently locked out of creating new workspaces from a
    // regular tab. The visual hiding of the create-workspace entry
    // point inside the iframe (via useEmbedded()) is sufficient.
  }

  return NextResponse.next({ request })
}

export const config = {
  // Dashboard pages PLUS the workspace-scoped API routes that call
  // auth() server-side. Excludes /api/auth/* — NextAuth's own
  // callbacks shouldn't be touched, and the embed handshake route
  // doesn't need a session to run.
  matcher: [
    // Root is matched so custom-domain visitors get rewritten to the
    // portal; on the primary host '/' falls through to the marketing page.
    '/',
    '/dashboard/:path*',
    '/api/workspaces/:path*',
    '/api/agents/:path*',
    '/api/integrations/:path*',
  ],
}
