import Link from 'next/link'
import type { Metadata } from 'next'
import MarketingNav from '@/components/landing/MarketingNav'
import MarketingFooter from '@/components/landing/MarketingFooter'
import { COMPARISONS } from '@/lib/compare-data'

export const metadata: Metadata = {
  title: 'Xovera vs. alternatives — honest comparisons',
  description: 'Transparent comparisons between Xovera and other AI agent options for sales and marketing teams. What each tool wins on, what it can\u2019t do, and when to pick which.',
  alternates: { canonical: '/compare' },
}

/**
 * /compare index. Lists every comparison + a disclaimer about the
 * "us vs. them" honesty standard. Gets its own layout (not the blog
 * layout) because comparison pages deserve a different visual
 * treatment — they're arguably a conversion surface, not just
 * content.
 */
export default function CompareIndex() {
  return (
    <div data-theme="soft-light" className="min-h-screen" style={{ background: 'var(--background)', color: 'var(--text-primary)' }}>
      <MarketingNav />

      <div className="max-w-[1000px] mx-auto px-6 py-16">
        <header className="mb-12">
          <nav className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
            <Link href="/" className="hover:text-[var(--text-primary)]">Home</Link>
            <span className="mx-2">/</span>
            <span style={{ color: 'var(--text-secondary)' }}>Compare</span>
          </nav>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">Xovera vs. alternatives</h1>
          <p className="text-lg max-w-2xl" style={{ color: 'var(--text-secondary)' }}>
            Honest comparisons between Xovera and other AI agent options for sales and marketing teams — including scenarios where the other tool is genuinely the right pick.
          </p>
        </header>

        <div className="space-y-4">
          {COMPARISONS.map(c => (
            <Link
              key={c.slug}
              href={`/compare/${c.slug}`}
              className="block vox-card p-6 hover:border-zinc-600 transition-colors"
            >
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--accent-primary)' }}>
                    {c.us} vs. {c.them}
                  </div>
                  <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{c.title}</h2>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{c.description}</p>
                </div>
                <div className="shrink-0 text-xs font-mono" style={{ color: 'var(--text-tertiary)' }}>
                  Updated {c.updatedAt}
                </div>
              </div>
            </Link>
          ))}
        </div>

        <p className="mt-16 text-[11px] max-w-xl" style={{ color: 'var(--text-tertiary)' }}>
          These comparisons are written by the Xovera team. We fact-check what we say about competitors from their public product pages, and we update pages when they change. If you work at a product we compare ourselves to and something is wrong, tell us at <a href="https://xovera.canny.io" className="underline">xovera.canny.io</a>.
        </p>
      </div>
      <MarketingFooter />
    </div>
  )
}
