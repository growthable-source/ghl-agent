import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import SolutionPage from '@/components/marketing/SolutionPage'
import { findSolution } from '@/lib/solutions-data'

const SLUG = 'ai-chat-widget-builder'

export function generateMetadata(): Metadata {
  const s = findSolution(SLUG)
  if (!s) return {}
  return {
    title: s.metaTitle,
    description: s.metaDescription,
    alternates: { canonical: `/${SLUG}` },
    openGraph: { title: s.metaTitle, description: s.metaDescription, type: 'website', url: `/${SLUG}` },
    twitter: { card: 'summary_large_image', title: s.metaTitle, description: s.metaDescription },
  }
}

export default function Page() {
  const s = findSolution(SLUG)
  if (!s) notFound()
  return <SolutionPage data={s} />
}
