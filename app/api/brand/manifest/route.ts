/**
 * Web app manifest for a customer-branded host — app/manifest.ts names
 * us and starts at /dashboard (blocked on custom hosts). Reached only via
 * the middleware rewrite of /manifest.webmanifest on custom hosts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { assetBrand } from '@/lib/domains/host-brand'
import { brandManifest } from '@/lib/domains/brand-metadata'
import { isPrimaryHost } from '@/lib/domains/primary-hosts'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const host = (req.headers.get('host') || '').toLowerCase().split(':')[0]
  // Our own host only in white-label test mode (lib/whitelabel/preview.ts).
  const testBrand = host && isPrimaryHost(host) ? await assetBrand(host) : null
  if (!host || (isPrimaryHost(host) && !testBrand)) return new NextResponse('Not found', { status: 404 })
  const brand = testBrand ?? await assetBrand(host)
  return NextResponse.json(brandManifest(brand ?? { name: '', iconUrl: null, accent: null }), {
    headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': testBrand ? 'private, no-store' : 'public, max-age=300, s-maxage=300' },
  })
}
