import Link from 'next/link'
import { db } from '@/lib/db'
import HelpSearch from './HelpSearch'

export const revalidate = 60  // ISR — pages refresh every minute

/**
 * Help center landing. Big search up top, category grid below. Crawlable;
 * static-ish via ISR so a crawler hit doesn't thrash the DB.
 */
export default async function HelpLanding() {
  const [categories, latest] = await Promise.all([
    db.helpCategory.findMany({
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      include: {
        _count: { select: { articles: { where: { status: 'published' } } } },
      },
    }),
    db.helpArticle.findMany({
      where: { status: 'published' },
      orderBy: { publishedAt: 'desc' },
      include: { category: true },
      take: 6,
    }),
  ])

  return (
    <div className="space-y-12">
      {/* Hero + search */}
      <section className="text-center py-12">
        <h1 className="text-4xl font-bold text-zinc-50 tracking-tight">How can we help?</h1>
        <p className="mt-3 text-zinc-400">Guides, videos, and reference material for building with Voxility.</p>
        <div className="mt-8 max-w-2xl mx-auto">
          <HelpSearch />
        </div>
      </section>

      {/* Category grid */}
      {categories.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-4">Browse by topic</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {categories.map(c => (
              <Link
                key={c.id}
                href={`/help/c/${c.slug}`}
                className="block rounded-xl border border-zinc-800 bg-zinc-950 hover:border-zinc-600 p-5 transition-colors"
              >
                <div className="flex items-start gap-3">
                  {c.icon && <span className="text-2xl">{c.icon}</span>}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-zinc-100">{c.name}</div>
                    {c.description && <p className="text-xs text-zinc-500 mt-1 line-clamp-2">{c.description}</p>}
                    <p className="text-[11px] text-zinc-600 mt-2">
                      {c._count.articles} {c._count.articles === 1 ? 'article' : 'articles'}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Latest */}
      {latest.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-4">Recently updated</h2>
          <div className="space-y-2">
            {latest.map(a => (
              <Link
                key={a.id}
                href={`/help/a/${a.slug}`}
                className="block rounded-lg border border-zinc-800 hover:border-zinc-600 bg-zinc-950 px-4 py-3 transition-colors"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-zinc-100">{a.title}</div>
                    {a.summary && <p className="text-xs text-zinc-500 mt-0.5 line-clamp-1">{a.summary}</p>}
                  </div>
                  {a.category && (
                    <span className="text-[10px] text-zinc-500 bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 shrink-0">
                      {a.category.name}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {categories.length === 0 && latest.length === 0 && (
        <section className="text-center py-20 text-zinc-500 text-sm">
          No articles published yet. Check back soon.
        </section>
      )}
    </div>
  )
}
