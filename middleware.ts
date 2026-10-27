import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  EMBED_SESSION_COOKIE,
  EMBED_WORKSPACE_COOKIE,
  REGULAR_SESSION_COOKIE,
} from '@/lib/embed-session'
import { isPrimaryHost } from '@/lib/domains/primary-hosts'
import { brandAssetRewrite, isBlockedOnCustomHost } from '@/lib/domains/hostname'
import { METHOD_HEADER, PATH_HEADER, SIG_HEADER, requestPathSecret, signRequestPath } from '@/lib/whitelabel/request-path'

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
/**
 * Paths the middleware handled BEFORE white-label domains existed (the
 * original matcher). The matcher is now broad so custom hosts can be
 * allowlisted; on the primary host everything outside this set returns
 * immediately, i.e. behaves exactly as it did when it never matched.
 */
function isLegacyMatchedPath(path: string): boolean {
  return (
    path === '/' ||
    path.startsWith('/api/cron/') ||
    path.startsWith('/dashboard') ||
    path.startsWith('/embedded') ||
    path.startsWith('/api/workspaces/') ||
    path.startsWith('/api/agents/') ||
    path.startsWith('/api/integrations/')
  )
}

export async function middleware(request: NextRequest) {
  const hostHeader = (request.headers.get('host') || '').toLowerCase().split(':')[0]
  const onCustomHost = !!hostHeader && !isPrimaryHost(hostHeader)
  const pathname = request.nextUrl.pathname

  // A white-label team signs in on its own branded page (app/sign-in);
  // our /login (Google/GitHub) is never served on a customer host.
  if (onCustomHost && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/sign-in'
    return NextResponse.redirect(url)
  }
  // Creating workspaces and editing our help center are ours, not the
  // customer team's; /dashboard on a custom host resolves to its workspace.
  if (onCustomHost && /^\/dashboard\/(new|help-admin)(\/|$)/.test(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.search = ''
    return NextResponse.redirect(url)
  }

  // Customer-branded hosts (portal + workspace white-label) serve a fixed
  // allowlist of public surfaces; everything else — dashboard, auth,
  // admin, workspace APIs — is a 404 there. See lib/domains/hostname.ts.
  if (isBlockedOnCustomHost(hostHeader, pathname)) {
    return new NextResponse('Not found', { status: 404 })
  }
  if (!onCustomHost && !isLegacyMatchedPath(pathname)) {
    return NextResponse.next()
  }

  // Our favicon / app icon / OG image / manifest are file-based and
  // apply to every route, so a custom host would otherwise show our logo
  // in the tab. Swap them for the customer's brand (resolved by host in
  // the Node route — no DB here).
  const brandAsset = onCustomHost ? brandAssetRewrite(pathname) : null
  if (brandAsset) {
    const url = request.nextUrl.clone()
    url.pathname = brandAsset
    url.search = ''
    return NextResponse.rewrite(url)
  }

  // Cron dedup for the widget-runtime deployment. vercel.json crons fire
  // on EVERY Vercel project deploying this repo, and the xovera-widget
  // project (IS_WIDGET_RUNTIME=1) ships the same codebase — without this
  // guard every cron would run twice per tick, double-sending outbox
  // messages and double-running agent recovery. The main project owns
  // all scheduled work; the widget runtime only serves chat traffic.
  if (process.env.IS_WIDGET_RUNTIME === '1' && request.nextUrl.pathname.startsWith('/api/cron')) {
    return new NextResponse(null, { status: 204 })
  }

  // Signed path + method for the central access guards (lib/whitelabel/
  // guard.ts): route handlers can't see their own URL, and the Support
  // Agent allowlist is keyed on it. Always overwritten, never trusted
  // from the client — see lib/whitelabel/request-path.ts.
  request.headers.delete(PATH_HEADER)
  request.headers.delete(METHOD_HEADER)
  request.headers.delete(SIG_HEADER)
  const pathSecret = requestPathSecret()
  if (pathSecret) {
    request.headers.set(PATH_HEADER, pathname)
    request.headers.set(METHOD_HEADER, request.method)
    request.headers.set(SIG_HEADER, await signRequestPath(pathname, request.method, pathSecret))
  }

  const regular = request.cookies.get(REGULAR_SESSION_COOKIE)
  const embed = request.cookies.get(EMBED_SESSION_COOKIE)

  // Also accept the non-prefixed cookie name (dev only — production
  // always uses the __Secure- prefix). On prod this branch is a no-op.
  const regularUnprefixed = request.cookies.get('authjs.session-token')

  // Where the EMBED session must win even when a regular browser session
  // is also present. An SSO handshake deliberately signed this context in
  // as a specific user; a bystanding personal session must not shadow it.
  //
  // Without this, anyone who held their own Xovera session — platform
  // staff, or a customer who also signed up directly — could never use a
  // partner-embedded surface: auth() resolved their personal account,
  // which isn't a member of the partner-provisioned workspace, and the
  // builder answered "your account does not have access to this widget".
  //
  //   1. /embedded/*: these pages only exist behind a handshake.
  //   2. API calls aimed at the workspace the embed session is bound to
  //      (EMBED_WORKSPACE_COOKIE, re-asserted on every handshake) — the
  //      builder's own saves. Scoped to that one workspace so a stale
  //      embed cookie can't shadow normal dashboard use of anything else.
  const path = request.nextUrl.pathname
  const embedWorkspace = request.cookies.get(EMBED_WORKSPACE_COOKIE)?.value
  const embedTakesPrecedence =
    path.startsWith('/embedded') ||
    (!!embedWorkspace &&
      (path === `/api/workspaces/${embedWorkspace}` ||
        path.startsWith(`/api/workspaces/${embedWorkspace}/`)))

  // Promote the embed cookie onto the regular cookie for the request
  // that's about to be forwarded. The DB row backing this sessionToken
  // is identical regardless of which cookie carried it.
  if (embed && (embedTakesPrecedence || (!regular && !regularUnprefixed))) {
    request.cookies.set(REGULAR_SESSION_COOKIE, embed.value)
  }

  // Whitelabel routing: on a custom host the root path never serves the
  // Xovera marketing site. Edge has no DB, so we can't tell a portal
  // domain from a workspace domain here — app/domain-root decides
  // (portal → /portal; workspace → its configured URL or a branded
  // landing). It used to rewrite straight to /portal, which put a
  // "Customer Portal" login on every workspace's live-help domain.
  if (pathname === '/' && onCustomHost) {
    const url = request.nextUrl.clone()
    url.pathname = '/domain-root'
    return NextResponse.rewrite(url, { request })
  }

  // Only /dashboard/* requires a session; the API routes the matcher
  // covers do their own per-route auth (often workspace-scoped) and
  // we don't want to short-circuit them here.
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    // voxility_support: a super admin's support session (verified, with
    // the admin session it depends on, by auth() — lib/support-session.ts).
    // Staff often have no regular app sign-in at all.
    const support = request.cookies.get('voxility_support')
    const hasAnySession = !!(regular || regularUnprefixed || embed || support)
    if (!hasAnySession) {
      // wl_preview: white-label test mode (lib/whitelabel/preview.ts) —
      // send the tester back to the branded sign-in, not our /login. The
      // cookie is only honoured server-side off production.
      const teamSignIn = onCustomHost || !!request.cookies.get('wl_preview')
      const loginUrl = new URL(teamSignIn ? '/sign-in' : '/login', request.url)
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
    // Everything except Next's static assets, for NON-primary hosts only:
    // custom hosts need an allowlist check on EVERY path (see middleware
    // body). The entries below remain for primary hosts' legacy paths.
    // `missing` host skips our own hosts at the routing layer so the app's
    // normal traffic (widget SSE, assets, APIs) doesn't pay for an Edge
    // invocation. Hosts the regex doesn't know (env-added PRIMARY_HOSTS)
    // still run middleware and are classified in code by isPrimaryHost().
    {
      source: '/((?!_next/static|_next/image).*)',
      missing: [
        {
          type: 'host',
          // ONE outer group: Next wraps the value as ^value$, so top-level
          // alternation would anchor only the first/last branch and let
          // hosts like localhost.acme.com or live.xovera.io.acme.com skip
          // middleware. Ports are stripped by Next before matching.
          value: '((.*\\.)?(xovera\\.io|voxility\\.ai)|localhost|127\\.0\\.0\\.1|.*\\.vercel\\.app)',
        },
      ],
    },
    // Root is matched so custom-domain visitors get rewritten to the
    // portal; on the primary host '/' falls through to the marketing page.
    '/',
    // Matched ONLY for the widget-runtime cron guard above — on the main
    // project the guard is a no-op and crons pass straight through.
    '/api/cron/:path*',
    '/dashboard/:path*',
    // Without this entry the embed-cookie promotion above never ran on
    // the partner builder pages at all: auth() reads only the regular
    // cookie name, the regular cookie is SameSite=Lax so it never
    // travels into the partner's iframe, and the SameSite=None embed
    // cookie the handshake had just minted was simply never looked at.
    // Every iframe load of /embedded/widget-builder/[widgetId] resolved
    // no session and showed "session has expired" — indistinguishable,
    // from outside, from the browser actually blocking cookies.
    '/embedded/:path*',
    '/api/workspaces/:path*',
    '/api/agents/:path*',
    '/api/integrations/:path*',
  ],
}
