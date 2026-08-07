import type { NextConfig } from "next";

// ─── Iframe embedding policy ─────────────────────────────────────────
// We deliberately allow ANY parent origin to embed the dashboard /
// embedded routes. The marketplace runs on thousands of whitelabel
// domains — every agency that resells the CRM gets its own (e.g.
// app.acmeagency.com, crm.example.io). Enumerating them in a CSP
// allowlist is impossible.
//
// The security model isn't "trust the parent origin" — it's:
//
//   1. The SSO handshake (/api/auth/leadconnector-iframe-handshake)
//      requires an encrypted payload signed with our Shared Secret.
//      A malicious parent can fake the postMessage but cannot fake the
//      ciphertext — the decrypt fails and no session is minted.
//   2. The session cookie minted by the handshake is short-lived per
//      iframe load and tied to a specific Location/Workspace, so a
//      compromised cookie's blast radius is one tenant.
//
// What we lose by allowing any parent: defense against clickjacking
// for users who are already signed into Xovera *outside* the iframe
// (a SameSite=None session cookie travels in any frame). Follow-up to
// mitigate: split the embed-session cookie from the regular browser
// cookie so a malicious parent can't piggyback on a passive session.
// Tracked separately — not blocking this ship.
//
// Setting frame-ancestors to '*' is the same as omitting the directive
// (browser default is permissive), but being explicit documents the
// decision in the response headers themselves.
const FRAME_ANCESTORS_DIRECTIVE = "frame-ancestors *;"

// ─── Partner builder embedding ───────────────────────────────────────
// The permissive policy above exists because marketplace whitelabel
// domains are unenumerable. That reasoning does NOT extend to the
// partner widget builder: the help centre is our own product, served
// from origins we control and can list. So this route gets a real
// allowlist.
//
// PARTNER_FRAME_ANCESTORS is space-separated, e.g.
//   "https://help.example.com https://admin.example.com"
// Unset falls back to '*', which keeps local development and preview
// deployments working rather than silently refusing to frame.
//
// This file is evaluated BEFORE .env.local is loaded, so a value put
// there is NOT picked up — locally you get the '*' fallback unless you
// export the variable in your shell. On Vercel it works, because
// project env vars are real process-env entries at build time and
// process.env is the first place Next looks (see "Environment Variable
// Load Order" in the env-vars guide).
const PARTNER_FRAME_ANCESTORS_DIRECTIVE =
  `frame-ancestors ${(process.env.PARTNER_FRAME_ANCESTORS || '').trim() || '*'};`

const nextConfig: NextConfig = {
  experimental: {
    // Client router cache for visited page segments. Next 15+ defaults
    // dynamic to 0s, so EVERY navigation refetched the page's RSC
    // payload from the server — combined with the function↔DB distance
    // this made each sidebar click feel like ~1s. Dashboard pages are
    // client components that fetch their own data on mount, so the
    // cached payload is just the page shell — serving it instantly for
    // 60s carries no content-staleness risk (data still refetches).
    staleTimes: {
      dynamic: 60,
      static: 300,
    },
  },
  async headers() {
    // Split into explicit per-prefix rules. Next.js's headers config
    // uses path-to-regexp, which supports regex *only* after a named
    // parameter (`:slug(\\d{1,})`). The earlier `/(dashboard|embedded)/:path*`
    // form happened to fire on Vercel but is outside the documented
    // grammar — separate rules are safer.
    const cspHeader = { key: "Content-Security-Policy", value: FRAME_ANCESTORS_DIRECTIVE }
    return [
      { source: "/dashboard/:path*", headers: [cspHeader] },
      { source: "/embedded/:path*", headers: [cspHeader] },
      // MUST come AFTER the general /embedded rule. Next.js applies
      // EVERY matching rule, and for a repeated header key the LAST one
      // wins ("Header Overriding Behavior" in the headers docs) — so the
      // narrow partner policy has to be written last or the broad
      // frame-ancestors * silently overwrites it. Verified by curling
      // the route with PARTNER_FRAME_ANCESTORS set; the earlier ordering
      // produced '*' on the builder route.
      {
        source: "/embedded/widget-builder",
        headers: [{ key: "Content-Security-Policy", value: PARTNER_FRAME_ANCESTORS_DIRECTIVE }],
      },
      {
        source: "/embedded/widget-builder/:path*",
        headers: [{ key: "Content-Security-Policy", value: PARTNER_FRAME_ANCESTORS_DIRECTIVE }],
      },
      { source: "/api/auth/partner-builder-handshake", headers: [cspHeader] },
      // The customer portal is embeddable in the LeadConnector menu via
      // custom menu links — same thousands-of-whitelabel-domains reality
      // as the dashboard, so the same frame-ancestors * decision applies.
      // Auth is the portal's own JWT cookie, not parent-origin trust.
      { source: "/portal/:path*", headers: [cspHeader] },
      { source: "/api/auth/leadconnector-iframe-handshake", headers: [cspHeader] },
      // The embed loader runs on customer sites where browsers (and WP
      // caching/optimizer plugins) hold on to whatever copy they first
      // fetched — a stale widget.js kept shipping iframes without the
      // purl origin param long after the fix deployed. A short explicit
      // TTL caps how long any cached copy can lag behind a deploy.
      {
        source: "/widget.js",
        headers: [{ key: "Cache-Control", value: "public, max-age=300, must-revalidate" }],
      },
      // Same short TTL for the marketplace Custom JS file — the CRM
      // injects it on every dashboard load and we want deploys to
      // propagate within minutes, not at the browser cache's mercy.
      {
        source: "/leadconnector-app-embed.js",
        headers: [{ key: "Cache-Control", value: "public, max-age=300, must-revalidate" }],
      },
    ]
  },
}

export default nextConfig;
