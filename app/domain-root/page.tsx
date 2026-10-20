/**
 * What https://<custom host>/ serves. Middleware rewrites the bare root
 * of every custom host here (Edge can't tell the host kinds apart):
 *
 *   portal domain     → /portal (its login / overview, branded by host)
 *   workspace domain  → Workspace.whitelabelRootUrl when set (usually
 *                       the customer's own site), else a minimal branded
 *                       page. Never the portal: the portal isn't the
 *                       workspace's, and its login confused customers.
 *   anything else     → 404
 *
 * Not reachable on our own hosts (404), and not directly on custom hosts
 * either — /domain-root isn't on the custom-host allowlist.
 */

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { customHostOrigin, resolveHostBrand } from '@/lib/domains/host-brand'
import { brandMetadata } from '@/lib/domains/brand-metadata'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get('host')
  const brand = await resolveHostBrand(host)
  return brand ? brandMetadata(brand, customHostOrigin(host)) : { robots: { index: false, follow: false } }
}

export default async function DomainRootPage() {
  const host = (await headers()).get('host')
  if (!customHostOrigin(host)) notFound()
  const brand = await resolveHostBrand(host)
  if (!brand) notFound()
  if (brand.kind === 'portal') redirect('/portal')
  if (brand.rootUrl) redirect(brand.rootUrl)

  const ws = await db.workspace.findUnique({ where: { id: brand.workspaceId }, select: { logoUrl: true } })
  return (
    <main className="min-h-screen flex items-center justify-center bg-white px-6">
      <div className="text-center">
        {ws?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ws.logoUrl} alt={brand.name} className="h-12 mx-auto mb-4" />
        ) : null}
        <h1 className="text-xl font-semibold text-zinc-900">{brand.name}</h1>
      </div>
    </main>
  )
}
