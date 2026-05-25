import type { NextConfig } from "next";

// GHL hosts our Custom App iframe under app.gohighlevel.com and its
// whitelabel mirror app.leadconnectorhq.com. Without an explicit
// frame-ancestors directive, Next.js sends `X-Frame-Options: SAMEORIGIN`
// by default, which makes the browser refuse to render our pages inside
// either of those parents. Setting CSP frame-ancestors here permits
// only those specific origins to embed us — anywhere else still gets
// the default deny.
//
// Add additional whitelabel/private-label HighLevel domains to this
// list if customers complain that the embedded view is blank.
const GHL_PARENT_ORIGINS = [
  "https://app.gohighlevel.com",
  "https://app.leadconnectorhq.com",
  "https://*.gohighlevel.com",
  "https://*.leadconnectorhq.com",
]

const nextConfig: NextConfig = {
  async headers() {
    const frameAncestors = `frame-ancestors 'self' ${GHL_PARENT_ORIGINS.join(" ")};`
    return [
      {
        // Apply to dashboard + embedded routes — the marketing site
        // and login pages keep the stricter default.
        source: "/(dashboard|embedded)/:path*",
        headers: [{ key: "Content-Security-Policy", value: frameAncestors }],
      },
      {
        source: "/api/auth/ghl-iframe-handshake",
        headers: [{ key: "Content-Security-Policy", value: frameAncestors }],
      },
    ]
  },
}

export default nextConfig;
