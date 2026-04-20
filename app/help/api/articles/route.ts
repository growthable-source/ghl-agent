import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /help/api/articles.json
 *
 * Public JSON feed of every published help article. This is the endpoint a
 * third-party live-chat provider (Intercom, Fin, Drift, custom) can crawl
 * to ingest the whole knowledge base.
 *
 * Every field the chat agent could plausibly want is included: slug, title,
 * summary, body (raw markdown), category name, optional videoUrl, the
 * canonical URL on this site, and the last-updated timestamp for cache
 * invalidation. We don't ship drafts.
 */

export const revalidate = 300   // cache for 5 min — reduces crawl load

export async function GET() {
  const articles = await db.helpArticle.findMany({
    where: { status: 'published' },
    orderBy: [{ order: 'asc' }, { publishedAt: 'desc' }],
    include: { category: { select: { name: true, slug: true } } },
  })

  const base = process.env.APP_URL?.replace(/\/$/, '') || ''
  const payload = articles.map(a => ({
    slug: a.slug,
    title: a.title,
    summary: a.summary,
    body: a.body,
    category: a.category ? { name: a.category.name, slug: a.category.slug } : null,
    videoUrl: a.videoUrl,
    url: `${base}/help/a/${a.slug}`,
    publishedAt: a.publishedAt?.toISOString() ?? null,
    updatedAt: a.updatedAt.toISOString(),
  }))

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    count: payload.length,
    articles: payload,
  }, {
    headers: {
      // Allow any origin to fetch — it's public, read-only content.
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  })
}
