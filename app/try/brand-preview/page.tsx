/**
 * Dev-only visual harness for the whitelabel demo landers (lib/demo-brands).
 *
 * Renders TryDemoClient with fixture props and NO database read, so a new
 * brand's logo, palette, copy and social proof can be eyeballed without a
 * DemoProspect row — which matters because the local env has no reachable
 * database, and pointing a dev server at production to preview copy would
 * be a bad trade.
 *
 *   /try/brand-preview?brand=asc
 *   /try/brand-preview?brand=xovera
 *
 * 404s in production: it renders a page that looks like a real prospect
 * lander, and nothing should be able to reach that without a real slug.
 * The status/token routes it calls will 404 for slug "__preview", so the
 * page settles into the pre-provision 'train' phase — layout and branding
 * are faithful, the live call is not exercised here.
 */
import { notFound } from 'next/navigation'
import TryDemoClient from '../[slug]/TryDemoClient'

export default async function BrandPreview({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { brand } = await searchParams
  return (
    <TryDemoClient
      brandKey={brand || 'asc'}
      slug="__preview"
      businessName="Riverside Motors"
      websiteUrl="https://riversidemotors.com"
      websiteDomain="riversidemotors.com"
      vertical="dealership"
      initialStatus="ready"
      contactEmail={null}
      checkoutHref="https://example.com/checkout"
      checkoutMode="external"
      learnMoreHref="/ai-receptionist"
      introDeadline={null}
    />
  )
}
