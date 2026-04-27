import Link from 'next/link'
import type { Metadata } from 'next'
import { POSTS, type BlogCategory } from '@/lib/blog-posts'

export const metadata: Metadata = {
  title: 'Blog — AI agents for GoHighLevel & HubSpot',
  description: 'Guides, comparisons, and product updates from the team building Voxility. How to add AI to GoHighLevel, comparisons vs Synthflow / HubSpot AI, and deep dives on conversational AI for sales and service.',
  alternates: { canonical: '/blog' },
}

/**
 * Blog index. Groups posts by category for scannability, lists the 3
 * most recent at the top as a "Latest" strip. Crawlable, statically
 * renderable (no DB; registry is compiled-in).
 */
export default function BlogIndex() {
  const sorted = [...POSTS].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  const latest = sorted.slice(0, 3)

  const byCategory = POSTS.reduce((acc, p) => {
    ;(acc[p.category] ??= []).push(p)
    return acc
  }, {} as Record<BlogCategory, typeof POSTS>)

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-16">
      {/* Header */}
      <header className="mb-14">
        <nav className="text-xs mb-4" style={{ color: '#64748b' }}>
          <Link href="/" className="hover:text-white">Home</Link>
          <span className="mx-2">/</span>
          <span style={{ color: '#94a3b8' }}>Blog</span>
        </nav>
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-3">Voxility blog</h1>
        <p className="text-lg max-w-2xl" style={{ color: '#94a3b8' }}>
          Guides, comparisons, and product updates from the team building self-improving AI agents for GoHighLevel and HubSpot.
        </p>
      </header>

      {/* Latest strip */}
      {latest.length > 0 && (
        <section className="mb-16">
          <h2 className="text-xs font-semibold uppercase tracking-wider mb-5" style={{ color: '#64748b' }}>Latest</h2>
          <div className="grid md:grid-cols-3 gap-4">
            {latest.map(p => (
              <Link
                key={p.slug}
                href={`/blog/${p.slug}`}
                className="group vox-card p-6 hover:border-zinc-600 transition-all"
                style={{ background: 'linear-gradient(135deg, #090d15 0%, #0c111d 100%)' }}
              >
                <div className="flex items-center gap-2 mb-3 text-[11px]" style={{ color: '#64748b' }}>
                  <span className="uppercase tracking-wider font-semibold" style={{ color: '#fa4d2e' }}>{p.category}</span>
                  <span>·</span>
                  <span>{p.readingTimeMinutes} min read</span>
                </div>
                <h3 className="text-lg font-semibold leading-snug mb-3 group-hover:text-white transition-colors" style={{ color: '#f8fafc' }}>
                  {p.title}
                </h3>
                <p className="text-sm leading-[1.6] mb-4" style={{ color: '#94a3b8' }}>
                  {p.description}
                </p>
                <div className="text-xs" style={{ color: '#64748b' }}>
                  {new Date(p.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Category sections */}
      {(Object.keys(byCategory) as BlogCategory[]).sort().map(cat => (
        <section key={cat} className="mb-14">
          <h2 className="text-lg font-semibold mb-4" style={{ color: '#f8fafc' }}>{cat}</h2>
          <div className="divide-y" style={{ borderColor: '#121a2b' }}>
            {byCategory[cat].map(p => (
              <Link
                key={p.slug}
                href={`/blog/${p.slug}`}
                className="flex items-start justify-between gap-6 py-5 border-t first:border-t-0 hover:bg-[#090d15]/60 -mx-4 px-4 rounded-lg transition-colors"
                style={{ borderColor: '#121a2b' }}
              >
                <div className="min-w-0">
                  <h3 className="font-semibold mb-1" style={{ color: '#f8fafc' }}>{p.title}</h3>
                  <p className="text-sm leading-[1.55]" style={{ color: '#94a3b8' }}>{p.description}</p>
                </div>
                <div className="shrink-0 text-right text-xs" style={{ color: '#64748b' }}>
                  <div>{new Date(p.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                  <div className="mt-1">{p.readingTimeMinutes} min</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
