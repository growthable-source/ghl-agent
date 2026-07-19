import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { landingPathForVertical } from '@/lib/demo-prospects/templates'
import TryDemoClient from './TryDemoClient'

type Params = { params: Promise<{ slug: string }> }

// Cold-email demo pages must never be indexed.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const p = await db.demoProspect.findUnique({
    where: { slug },
    select: { businessName: true },
  }).catch(() => null)
  if (!p) return { title: 'Not found', robots: { index: false, follow: false } }
  return {
    title: `${p.businessName} — AI receptionist demo`,
    description: `Hear the AI receptionist Xovera built for ${p.businessName}.`,
    robots: { index: false, follow: false },
  }
}

// Default direct-checkout offer. Overridable per prospect via
// metadata.checkoutUrl (https only) so campaigns can carry their own offer.
// Also doubles as the fallback CTA target when embedded checkout isn't
// configured yet (see checkoutMode below) so prod never dead-ends before
// Ryan sets NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.
const DEFAULT_CHECKOUT_URL = process.env.DEMO_CHECKOUT_URL || 'https://link.funnl.me/payment-link/6a5acc857b99151a5403f3d5'

export default async function TryDemoPage({ params }: Params) {
  const { slug } = await params
  const prospect = await db.demoProspect.findUnique({
    where: { slug },
    select: { slug: true, businessName: true, websiteUrl: true, websiteDomain: true, vertical: true, status: true, metadata: true, contactEmail: true },
  }).catch(() => null)
  if (!prospect) notFound()

  const metaCheckout = (prospect.metadata as Record<string, unknown> | null)?.checkoutUrl
  const checkoutHref =
    typeof metaCheckout === 'string' && metaCheckout.startsWith('https://')
      ? metaCheckout
      : DEFAULT_CHECKOUT_URL

  // Embedded in-modal checkout requires the publishable key at build/runtime.
  // Until Ryan sets it (see the plan's "Ryan must do" list), every CTA
  // falls back to the external checkoutHref above instead of opening a
  // modal that can never mount Stripe Elements.
  const checkoutMode: 'embedded' | 'external' = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ? 'embedded' : 'external'

  return (
    <TryDemoClient
      slug={prospect.slug}
      businessName={prospect.businessName}
      websiteUrl={prospect.websiteUrl}
      websiteDomain={prospect.websiteDomain}
      vertical={prospect.vertical}
      initialStatus={prospect.status}
      contactEmail={prospect.contactEmail}
      checkoutHref={checkoutHref}
      checkoutMode={checkoutMode}
      learnMoreHref={`${landingPathForVertical(prospect.vertical)}?demo=${prospect.slug}`}
    />
  )
}
