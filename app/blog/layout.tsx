import type { Metadata } from 'next'
import MarketingNav from '@/components/landing/MarketingNav'
import MarketingFooter from '@/components/landing/MarketingFooter'

export const metadata: Metadata = {
  title: {
    default: 'Blog',
    template: '%s | Voxility Blog',
  },
  description: 'Guides, comparisons, and product updates from the team building the self-improving AI agent platform for sales and marketing teams.',
  alternates: { canonical: '/blog' },
}

/**
 * Shared blog chrome — now the unified soft-light marketing nav + footer,
 * so clicking marketing → blog → marketing feels like one (light) site.
 */
export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="soft-light" className="min-h-screen" style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
      <MarketingNav />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  )
}
