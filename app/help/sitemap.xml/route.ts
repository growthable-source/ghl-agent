import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /help/sitemap.xml
 * Standard sitemap so search engines and crawlers discover every published
 * help article. Includes the landing page, each category page, and each
 * article page.
 */

export const revalidate = 600    // 10 min

export async function GET() {
  const base = process.env.APP_URL?.replace(/\/$/, '') || ''

  const [categories, articles] = await Promise.all([
    db.helpCategory.findMany({ select: { slug: true, updatedAt: true } }),
    db.helpArticle.findMany({
      where: { status: 'published' },
      select: { slug: true, updatedAt: true },
    }),
  ])

  const urls: Array<{ loc: string; lastmod?: string }> = [
    { loc: `${base}/help` },
    ...categories.map(c => ({ loc: `${base}/help/c/${c.slug}`, lastmod: c.updatedAt.toISOString() })),
    ...articles.map(a => ({ loc: `${base}/help/a/${a.slug}`, lastmod: a.updatedAt.toISOString() })),
  ]

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>`

  return new NextResponse(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}
