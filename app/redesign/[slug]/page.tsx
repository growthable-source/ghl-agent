import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import RedesignClient from './RedesignClient'

type Params = { params: Promise<{ slug: string }> }

/**
 * The website-redesign offer's personalized landing page.
 *
 * Sibling of /try/[slug]: same DemoProspect row, same cold-email entry point,
 * different offer. Where /try lets them hear an AI receptionist trained on
 * their business, this shows them a review of the site they already have and
 * offers to rebuild it free.
 *
 * The review is computed by the prospecting engine (engine/sitereview.py) and
 * arrives in `metadata.siteReview`. Everything shown here was observed from
 * their actual homepage — nothing on this page may assert anything the engine
 * didn't verify, because the whole offer rests on the critique being true.
 */

// Cold-email pages must never be indexed.
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const p = await db.demoProspect
    .findUnique({ where: { slug }, select: { businessName: true } })
    .catch(() => null)
  if (!p) return { title: 'Not found', robots: { index: false, follow: false } }
  return {
    title: `${p.businessName} — website review`,
    description: `A review of ${p.businessName}'s current website, and a free rebuild.`,
    robots: { index: false, follow: false },
  }
}

export type SiteReview = {
  summary?: string
  findings?: { title: string; detail: string }[]
  suggestions?: string[]
}

/** metadata.siteReview is sent as a JSON *string* — the registration API turns
 *  string metadata values into template vars, and a nested object would be
 *  dropped silently. Parse defensively: a malformed review must degrade to the
 *  offer alone, never to a broken page. */
function parseReview(metadata: unknown): SiteReview | null {
  const raw = (metadata as Record<string, unknown> | null)?.siteReview
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const parsed = JSON.parse(raw) as SiteReview
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export default async function RedesignPage({ params }: Params) {
  const { slug } = await params
  const prospect = await db.demoProspect
    .findUnique({
      where: { slug },
      select: {
        slug: true,
        businessName: true,
        websiteUrl: true,
        websiteDomain: true,
        contactEmail: true,
        metadata: true,
        clickedAt: true,
        redesignRequestedAt: true,
        previewUrl: true,
      },
    })
    .catch(() => null)
  if (!prospect) notFound()

  // "They opened the review" is the redesign offer's click-through signal, and
  // the engine reads clickedAt for both offers. Deliberately not reusing
  // /api/public/try/[slug]/status: that route 503s when voice-demo
  // provisioning isn't configured, which would couple this offer to the other
  // one's setup. Same idempotency guard as that route — conditioned on null so
  // refreshes and concurrent tabs can't re-stamp it.
  if (!prospect.clickedAt) {
    await db.demoProspect
      .updateMany({ where: { slug, clickedAt: null }, data: { clickedAt: new Date() } })
      .catch(() => {})
  }

  return (
    <RedesignClient
      slug={prospect.slug}
      businessName={prospect.businessName}
      websiteDomain={prospect.websiteDomain}
      websiteUrl={prospect.websiteUrl}
      contactEmail={prospect.contactEmail}
      review={parseReview(prospect.metadata)}
      alreadyRequested={Boolean(prospect.redesignRequestedAt)}
      previewUrl={prospect.previewUrl}
    />
  )
}
