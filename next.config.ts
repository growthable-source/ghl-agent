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
// for users who are already signed into Voxility *outside* the iframe
// (a SameSite=None session cookie travels in any frame). Follow-up to
// mitigate: split the embed-session cookie from the regular browser
// cookie so a malicious parent can't piggyback on a passive session.
// Tracked separately — not blocking this ship.
//
// Setting frame-ancestors to '*' is the same as omitting the directive
// (browser default is permissive), but being explicit documents the
// decision in the response headers themselves.
const FRAME_ANCESTORS_DIRECTIVE = "frame-ancestors *;"

const nextConfig: NextConfig = {
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
    ]
  },
}

export default nextConfig;
