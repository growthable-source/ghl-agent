import type { MetadataRoute } from 'next'
import { POSTS } from '@/lib/blog-posts'
import { COMPARISONS } from '@/lib/compare-data'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://voxility.ai'

/**
 * Root sitemap — covers the marketing surface + blog + comparisons.
 * Help articles have their own sitemap at /help/sitemap.xml that
 * lists individual posts; Google reads both without deduping.
 *
 * Priority heuristic:
 *   1.0 = landing page
 *   0.9 = blog/compare index pages (top-level hubs)
 *   0.8 = individual blog posts + comparisons + help root
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()

  const staticEntries: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/blog`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/compare`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/help`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ]

  const postEntries: MetadataRoute.Sitemap = POSTS.map(p => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    lastModified: new Date(p.updatedAt ?? p.publishedAt),
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }))

  const compareEntries: MetadataRoute.Sitemap = COMPARISONS.map(c => ({
    url: `${SITE_URL}/compare/${c.slug}`,
    lastModified: new Date(c.updatedAt),
    changeFrequency: 'monthly' as const,
    priority: 0.8,
  }))

  return [...staticEntries, ...postEntries, ...compareEntries]
}
