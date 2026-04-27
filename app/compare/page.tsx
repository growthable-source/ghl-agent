import Link from 'next/link'
import type { Metadata } from 'next'
import VoxilityLogo from '@/components/VoxilityLogo'
import { COMPARISONS } from '@/lib/compare-data'

export const metadata: Metadata = {
  title: 'Voxility vs. alternatives — honest comparisons',
  description: 'Transparent comparisons between Voxility and other AI agent options for GoHighLevel and HubSpot. What each tool wins on, what it can\u2019t do, and when to pick which.',
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
    <div className="min-h-screen" style={{ background: '#05080f', color: '#f8fafc' }}>
      <nav className="sticky top-0 z-50 backdrop-blur-xl border-b" style={{ background: 'rgba(5,8,15,0.92)', borderColor: 'rgba(18,26,43,0.8)' }}>
        <div className="max-w-[1200px] mx-auto flex items-center justify-between px-6 h-16">
          <Link href="/" className="flex items-center">
            <VoxilityLogo height={26} />
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm">
            <Link href="/" className="hover:text-white transition-colors" style={{ color: '#94a3b8' }}>Home</Link>
            <Link href="/blog" className="hover:text-white transition-colors" style={{ color: '#94a3b8' }}>Blog</Link>
            <Link href="/compare" className="hover:text-white transition-colors" style={{ color: '#94a3b8' }}>Compare</Link>
          </div>
          <Link href="/login?mode=signup" className="btn-primary text-sm py-2 px-5">Get started</Link>
        </div>
      </nav>

      <div className="max-w-[1000px] mx-auto px-6 py-16">
        <header className="mb-12">
          <nav className="text-xs mb-4" style={{ color: '#64748b' }}>
            <Link href="/" className="hover:text-white">Home</Link>
            <span className="mx-2">/</span>
            <span style={{ color: '#94a3b8' }}>Compare</span>
          </nav>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">Voxility vs. alternatives</h1>
          <p className="text-lg max-w-2xl" style={{ color: '#94a3b8' }}>
            Honest comparisons between Voxility and other AI agent options for GoHighLevel and HubSpot — including scenarios where the other tool is genuinely the right pick.
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
                  <div className="text-xs uppercase tracking-wider font-semibold mb-2" style={{ color: '#fa4d2e' }}>
                    {c.us} vs. {c.them}
                  </div>
                  <h2 className="text-xl font-semibold mb-2" style={{ color: '#f8fafc' }}>{c.title}</h2>
                  <p className="text-sm" style={{ color: '#94a3b8' }}>{c.description}</p>
                </div>
                <div className="shrink-0 text-xs font-mono" style={{ color: '#64748b' }}>
                  Updated {c.updatedAt}
                </div>
              </div>
            </Link>
          ))}
        </div>

        <p className="mt-16 text-[11px] max-w-xl" style={{ color: '#64748b' }}>
          These comparisons are written by the Voxility team. We fact-check what we say about competitors from their public product pages, and we update pages when they change. If you work at a product we compare ourselves to and something is wrong, tell us at <a href="https://voxility.canny.io" className="underline">voxility.canny.io</a>.
        </p>
      </div>
    </div>
  )
}
