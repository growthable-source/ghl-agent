import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://voxility.ai'

/**
 * /robots.txt — dynamic via Next's file convention.
 *
 * Posture: allow everything public, explicitly deny the authenticated
 * app and internal APIs. Disallowing /api is belt-and-braces; those
 * routes return JSON that isn't useful in a SERP anyway. /admin we
 * really don't want indexed under any circumstances.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/help', '/blog', '/compare'],
        disallow: [
          '/api/',
          '/admin/',
          '/admin',
          '/dashboard/',
          '/dashboard',
          '/login',
          '/widget/',
          '/_next/',
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
