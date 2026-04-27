import { POSTS } from '@/lib/blog-posts'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://voxility.ai'

/**
 * RSS 2.0 feed at /blog/rss.xml.
 *
 * Intentionally hand-rolled rather than pulled in a library — the
 * whole spec fits in 30 lines when you don't need the edge cases.
 * One gotcha: XML requires explicit CDATA or entity-escaping for
 * user content. We escape the fields below; the body text of posts
 * is left out of the feed on purpose (feeds that include full HTML
 * bodies fight with every reader's styling and bloat the payload).
 *
 * If we want full-content feeds later, switch to the Atom 1.0 format
 * which handles rich content more cleanly.
 */

// XML-safe the four characters that matter. Naive but correct for the
// string shapes we actually put in the feed (titles + descriptions).
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export async function GET() {
  const sorted = [...POSTS].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  const lastBuildDate = sorted[0]
    ? new Date(sorted[0].publishedAt).toUTCString()
    : new Date().toUTCString()

  const items = sorted
    .map(p => {
      const url = `${SITE_URL}/blog/${p.slug}`
      return [
        '    <item>',
        `      <title>${esc(p.title)}</title>`,
        `      <link>${url}</link>`,
        `      <guid isPermaLink="true">${url}</guid>`,
        `      <pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>`,
        `      <description>${esc(p.description)}</description>`,
        `      <category>${esc(p.category)}</category>`,
        `      <author>noreply@voxility.ai (${esc(p.author)})</author>`,
        '    </item>',
      ].join('\n')
    })
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Voxility Blog</title>
    <link>${SITE_URL}/blog</link>
    <atom:link href="${SITE_URL}/blog/rss.xml" rel="self" type="application/rss+xml" />
    <description>Guides, comparisons, and product updates from Voxility — the self-improving AI agent platform for GoHighLevel and HubSpot.</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
${items}
  </channel>
</rss>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      // Cache at the edge for an hour; any new post requires a
      // redeploy anyway so short-ish is fine.
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
