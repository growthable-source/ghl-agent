import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import AlternativePage from '@/components/marketing/AlternativePage'
import { findAlternative } from '@/lib/alternatives-data'

const SLUG = 'zendesk-ai-alternative'

export function generateMetadata(): Metadata {
  const a = findAlternative(SLUG)
  if (!a) return {}
  return {
    title: a.metaTitle,
    description: a.metaDescription,
    alternates: { canonical: `/${SLUG}` },
    openGraph: { title: a.metaTitle, description: a.metaDescription, type: 'article', url: `/${SLUG}` },
    twitter: { card: 'summary_large_image', title: a.metaTitle, description: a.metaDescription },
  }
}

export default function Page() {
  const a = findAlternative(SLUG)
  if (!a) notFound()
  return <AlternativePage data={a} />
}
