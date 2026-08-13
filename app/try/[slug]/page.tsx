import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { landingPathForVertical } from '@/lib/demo-prospects/templates'
import { offerStatus } from '@/lib/demo-purchase/offer'
import { STRIPE_PRICES } from '@/lib/plans'
import { brandKeyFromMetadata, getBrand, DEFAULT_BRAND_KEY } from '@/lib/demo-brands'
import TryDemoClient from './TryDemoClient'

type Params = { params: Promise<{ slug: string }> }

// Cold-email demo pages must never be indexed.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const p = await db.demoProspect.findUnique({
    where: { slug },
    select: { businessName: true, metadata: true },
  }).catch(() => null)
  if (!p) return { title: 'Not found', robots: { index: false, follow: false } }
  const brand = getBrand(brandKeyFromMetadata(p.metadata))
  const title = `${p.businessName} — AI receptionist demo | ${brand.name}`
  const description = brand.copy.metaDescription(p.businessName)

  // `absolute` bypasses the root layout's "%s | Xovera" title template.
  // Without it a partner-branded lander announces Xovera in the browser
  // tab — the one piece of chrome the prospect always sees.
  const metadata: Metadata = {
    title: { absolute: title },
    description,
    robots: { index: false, follow: false },
  }

  // Whitelabel brands also need the share card overridden. These links get
  // pasted into email and Slack, and without this the unfurl inherits the
  // root layout's og:* — Xovera's name, marketing headline and artwork on
  // a page wearing a partner's logo. Xovera-branded landers keep
  // inheriting exactly as they did before.
  if (brand.key !== DEFAULT_BRAND_KEY) {
    // The brand's own logo beats a wrong-brand hero image. A brand with no
    // raster asset sends an empty list, which suppresses the inherited
    // artwork rather than showing someone else's.
    const images = brand.logo.kind === 'image' ? [{ url: brand.logo.src }] : []
    metadata.openGraph = { title, description, siteName: brand.name, type: 'website', images }
    metadata.twitter = { card: 'summary', title, description, images }
  }

  return metadata
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
    select: { slug: true, businessName: true, websiteUrl: true, websiteDomain: true, vertical: true, status: true, metadata: true, contactEmail: true, clickedAt: true },
  }).catch(() => null)
  if (!prospect) notFound()

  // Whitelabel identity (logo, palette, copy, social proof) — keyed off
  // metadata.brand, which the prospecting tool sets at registration.
  // Absent/unknown → Xovera, so every pre-existing row is unaffected.
  const brand = getBrand(brandKeyFromMetadata(prospect.metadata))

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

  // Intro offer (80% off setup), anchored to the prospect's persisted
  // first-view timestamp so the countdown survives refreshes instead of
  // resetting — see lib/demo-purchase/offer.ts. Null (no countdown, full
  // price everywhere) once the window closes, and also when the
  // discounted Stripe price isn't configured: the checkout route falls
  // back to the full setup price in that case, and a page that advertised
  // a discount it can't charge would be worse than no offer at all.
  const offer = offerStatus(prospect.clickedAt)
  const introDeadline = offer.active && STRIPE_PRICES.demoBundle.setupIntro ? offer.deadline : null

  return (
    <TryDemoClient
      brandKey={brand.key}
      introDeadline={introDeadline}
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
