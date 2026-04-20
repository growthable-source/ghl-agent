import Link from 'next/link'
import { db } from '@/lib/db'
import HelpSearch from '../HelpSearch'

export const dynamic = 'force-dynamic'  // query-string driven, no ISR

export default async function HelpSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const query = (q || '').trim()

  const results = query
    ? await db.helpArticle.findMany({
        where: {
          status: 'published',
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { summary: { contains: query, mode: 'insensitive' } },
            { body: { contains: query, mode: 'insensitive' } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        include: { category: true },
        take: 50,
      })
    : []

  return (
    <div className="space-y-8">
      <div className="max-w-2xl mx-auto">
        <HelpSearch initial={query} />
      </div>

      <div className="max-w-3xl mx-auto">
        {!query ? (
          <p className="text-sm text-zinc-500 text-center py-10">Type a query above to search.</p>
        ) : results.length === 0 ? (
          <p className="text-sm text-zinc-500 text-center py-10">No articles matched &ldquo;{query}&rdquo;.</p>
        ) : (
          <>
            <p className="text-xs text-zinc-500 mb-4">
              {results.length} result{results.length === 1 ? '' : 's'} for &ldquo;{query}&rdquo;
            </p>
            <div className="space-y-2">
              {results.map(a => (
                <Link
                  key={a.id}
                  href={`/help/a/${a.slug}`}
                  className="block rounded-lg border border-zinc-800 hover:border-zinc-600 bg-zinc-950 px-4 py-3 transition-colors"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-zinc-100">{a.title}</div>
                      {a.summary && <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{a.summary}</p>}
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
          </>
        )}
      </div>
    </div>
  )
}
