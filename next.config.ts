import type { NextConfig } from "next";

// LeadConnector hosts our Custom App iframe under the parent origins
// below. Without an explicit frame-ancestors directive, Next.js sends
// `X-Frame-Options: SAMEORIGIN` by default, which makes the browser
// refuse to render our pages inside any of those parents. Setting CSP
// frame-ancestors here permits only those specific origins to embed
// us — anywhere else still gets the default deny.
//
// The literal hostnames have to stay because they ARE the marketplace
// parent domains; that's nothing we can rename on our side. Add
// additional whitelabel/private-label domains to this list if customers
// complain that the embedded view is blank.
const LEADCONNECTOR_PARENT_ORIGINS = [
  "https://app.gohighlevel.com",
  "https://app.leadconnectorhq.com",
  "https://*.gohighlevel.com",
  "https://*.leadconnectorhq.com",
]

const nextConfig: NextConfig = {
  async headers() {
    const frameAncestors = `frame-ancestors 'self' ${LEADCONNECTOR_PARENT_ORIGINS.join(" ")};`
    return [
      {
        // Apply to dashboard + embedded routes — the marketing site
        // and login pages keep the stricter default.
        source: "/(dashboard|embedded)/:path*",
        headers: [{ key: "Content-Security-Policy", value: frameAncestors }],
      },
      {
        source: "/api/auth/leadconnector-iframe-handshake",
        headers: [{ key: "Content-Security-Policy", value: frameAncestors }],
      },
    ]
  },
}

export default nextConfig;
