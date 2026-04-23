import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://voxility.ai'

/**
 * Root sitemap — covers the marketing surface. Help articles have their
 * own sitemap at /help/sitemap.xml that lists individual posts; we
 * don't duplicate those here because Google de-dupes them by URL
 * anyway and keeping them in one place simplifies authoring.
 *
 * Google reads the <lastmod> hint as a *suggestion*, not a guarantee
 * of freshness. We set the landing page to today's date at build time
 * so a redeploy after significant copy change bumps the hint forward.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  return [
    {
      url: `${SITE_URL}/`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/help`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ]
}
