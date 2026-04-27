import type { ComponentType } from 'react'

/**
 * Blog post registry.
 *
 * Posts live as TSX files in `content/blog/<slug>.tsx` — each exports
 * a default Body component and the metadata is declared inline in the
 * file (so there's one source of truth per post). This registry is the
 * runtime-importable catalogue of all published posts.
 *
 * New post checklist:
 *   1. Create `content/blog/<slug>.tsx` with a default export
 *   2. Import it here and add to POSTS
 *   3. Keep `slug` lowercase-kebab-case, matches filename
 *   4. Update `sitemap.ts` (it auto-reads from this registry)
 */

export interface BlogPostMeta {
  slug: string
  title: string
  description: string   // one sentence used as meta desc + card copy
  category: BlogCategory
  publishedAt: string   // ISO date
  updatedAt?: string    // optional, bump when the article is refreshed
  author: string
  readingTimeMinutes: number
  tags: string[]
}

export interface BlogPost extends BlogPostMeta {
  Body: ComponentType
}

export type BlogCategory =
  | 'Guides'
  | 'Comparisons'
  | 'Product'
  | 'Announcements'

// ── Imports ──────────────────────────────────────────────────────────
// Post modules live in content/blog/*. Each exports a Body component
// as default plus the `meta` object as a named export. We read them
// both here to build the registry.

import * as GhlListicle from '@/content/blog/best-ai-agents-for-gohighlevel'
import * as HowToInstall from '@/content/blog/how-to-add-ai-to-gohighlevel'

export const POSTS: BlogPost[] = [
  { ...GhlListicle.meta, Body: GhlListicle.default },
  { ...HowToInstall.meta, Body: HowToInstall.default },
]

/**
 * Return the N most-recent posts, optionally excluding a slug (handy
 * for "Related posts" lists). Reverse-chronological by publishedAt.
 */
export function recentPosts(n: number, excludeSlug?: string): BlogPost[] {
  return POSTS
    .filter(p => p.slug !== excludeSlug)
    .slice()
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, n)
}

/**
 * Simple tag-overlap relevance scoring for "Related posts" —
 * excludes the current post, ranks others by how many tags they
 * share, ties broken by recency. Zero tags in common still returns
 * the N most-recent as a fallback.
 */
export function relatedPosts(post: BlogPost, n = 3): BlogPost[] {
  const scored = POSTS
    .filter(p => p.slug !== post.slug)
    .map(p => ({
      post: p,
      overlap: p.tags.filter(t => post.tags.includes(t)).length,
    }))
    .sort((a, b) => {
      if (b.overlap !== a.overlap) return b.overlap - a.overlap
      return b.post.publishedAt.localeCompare(a.post.publishedAt)
    })
  return scored.slice(0, n).map(s => s.post)
}

export function findPostBySlug(slug: string): BlogPost | undefined {
  return POSTS.find(p => p.slug === slug)
}
