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

export default async function TryDemoPage({ params }: Params) {
  const { slug } = await params
  const prospect = await db.demoProspect.findUnique({
    where: { slug },
    select: { slug: true, businessName: true, websiteUrl: true, websiteDomain: true, vertical: true, status: true },
  }).catch(() => null)
  if (!prospect) notFound()

  return (
    <TryDemoClient
      slug={prospect.slug}
      businessName={prospect.businessName}
      websiteUrl={prospect.websiteUrl}
      websiteDomain={prospect.websiteDomain}
      initialStatus={prospect.status}
      learnMoreHref={`${landingPathForVertical(prospect.vertical)}?demo=${prospect.slug}`}
    />
  )
}
