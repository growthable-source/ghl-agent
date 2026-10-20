/**
 * Favicon / app icon / OG image for a customer-branded host.
 *
 * Reached only through the middleware rewrite of /favicon.ico,
 * /icon.svg, /apple-icon.png, /opengraph-image and /twitter-image on
 * custom hosts (lib/domains/hostname.ts → brandAssetRewrite) — our
 * file-based icons can't be overridden per segment, so we swap the
 * bytes instead. On our own hosts this route has nothing to brand.
 *
 * Uploaded/linked icon → 302 to it. None → generated initial SVG. An
 * unknown custom host gets the neutral tile, never our logo.
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveHostBrand } from '@/lib/domains/host-brand'
import { brandIconSvg } from '@/lib/domains/brand-metadata'
import { isPrimaryHost } from '@/lib/domains/primary-hosts'

export const dynamic = 'force-dynamic'

// Short: browsers cache favicons aggressively, and an operator who just
// uploaded a new one should see it within minutes.
const CACHE = 'public, max-age=300, s-maxage=300'

export async function GET(req: NextRequest) {
  const host = (req.headers.get('host') || '').toLowerCase().split(':')[0]
  if (!host || isPrimaryHost(host)) return new NextResponse('Not found', { status: 404 })

  const brand = await resolveHostBrand(host)
  if (brand?.iconUrl && /^https:\/\//i.test(brand.iconUrl)) {
    return NextResponse.redirect(brand.iconUrl, { status: 302, headers: { 'Cache-Control': CACHE } })
  }
  return new NextResponse(brandIconSvg(brand?.name, brand?.accent), {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': CACHE },
  })
}
