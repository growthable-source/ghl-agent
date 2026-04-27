import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { findPostBySlug, relatedPosts, POSTS } from '@/lib/blog-posts'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://voxility.ai'

type Params = { params: Promise<{ slug: string }> }

/**
 * Dynamic blog post page. Per-post metadata (title, description, OG)
 * resolves via `generateMetadata`; the actual article body is a React
 * component exported from the content registry.
 *
 * Inlines Article + BreadcrumbList JSON-LD so each post is
 * individually rich-result eligible — Google can show authorship,
 * published date, and breadcrumb chain in SERPs.
 */

export async function generateStaticParams() {
  return POSTS.map(p => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const post = findPostBySlug(slug)
  if (!post) return {}

  const url = `${SITE_URL}/blog/${post.slug}`
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: 'article',
      url,
      title: post.title,
      description: post.description,
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt ?? post.publishedAt,
      authors: [post.author],
      tags: post.tags,
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
    },
  }
}

export default async function BlogPostPage({ params }: Params) {
  const { slug } = await params
  const post = findPostBySlug(slug)
  if (!post) notFound()

  const Body = post.Body
  const related = relatedPosts(post, 3)

  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    image: `${SITE_URL}/blog/${post.slug}/opengraph-image`,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt ?? post.publishedAt,
    author: {
      '@type': 'Organization',
      name: post.author,
      url: SITE_URL,
    },
    publisher: {
      '@type': 'Organization',
      name: 'Voxility',
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/logo-color.svg`,
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/blog/${post.slug}`,
    },
    keywords: post.tags.join(', '),
  }

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${SITE_URL}/blog` },
      { '@type': 'ListItem', position: 3, name: post.title, item: `${SITE_URL}/blog/${post.slug}` },
    ],
  }

  return (
    <article className="max-w-[760px] mx-auto px-6 py-16">
      {/* Breadcrumb */}
      <nav className="text-xs mb-8" style={{ color: '#64748b' }}>
        <Link href="/" className="hover:text-white transition-colors">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/blog" className="hover:text-white transition-colors">Blog</Link>
        <span className="mx-2">/</span>
        <span style={{ color: '#94a3b8' }}>{post.category}</span>
      </nav>

      {/* Title block */}
      <header className="mb-10">
        <div className="flex items-center gap-2 mb-4 text-xs" style={{ color: '#64748b' }}>
          <span className="uppercase tracking-wider font-semibold" style={{ color: '#fa4d2e' }}>{post.category}</span>
          <span>·</span>
          <time dateTime={post.publishedAt}>
            {new Date(post.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </time>
          <span>·</span>
          <span>{post.readingTimeMinutes} min read</span>
        </div>
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.1] mb-5" style={{ color: '#f8fafc' }}>
          {post.title}
        </h1>
        <p className="text-lg leading-[1.6]" style={{ color: '#94a3b8' }}>
          {post.description}
        </p>
      </header>

      {/* Body (TSX from content/blog/<slug>.tsx) */}
      <Body />

      {/* Footer meta + tags */}
      <div className="mt-16 pt-8 border-t flex items-center justify-between text-sm" style={{ borderColor: '#121a2b', color: '#94a3b8' }}>
        <div>
          Written by <span style={{ color: '#f8fafc' }}>{post.author}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {post.tags.map(t => (
            <span key={t} className="text-[11px] uppercase tracking-wider rounded px-1.5 py-0.5" style={{ background: 'rgba(250,77,46,0.08)', color: '#fb8e6a' }}>
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* Related posts */}
      {related.length > 0 && (
        <section className="mt-16">
          <h2 className="text-xs font-semibold uppercase tracking-wider mb-5" style={{ color: '#64748b' }}>Related reading</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            {related.map(r => (
              <Link
                key={r.slug}
                href={`/blog/${r.slug}`}
                className="vox-card p-5 hover:border-zinc-600 transition-colors"
              >
                <div className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: '#fa4d2e' }}>
                  {r.category}
                </div>
                <h3 className="text-sm font-semibold leading-snug" style={{ color: '#f8fafc' }}>{r.title}</h3>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="mt-20 rounded-lg p-8 md:p-10 text-center" style={{ background: 'linear-gradient(135deg, #090d15 0%, #0f1524 100%)', border: '1px solid #121a2b' }}>
        <h2 className="text-2xl font-bold mb-3" style={{ color: '#f8fafc' }}>
          Ready to see it in action?
        </h2>
        <p className="mb-6" style={{ color: '#94a3b8' }}>
          Build your first AI agent in under 5 minutes. Free while in beta.
        </p>
        <Link href="/login?mode=signup" className="btn-primary">
          Start building free →
        </Link>
      </section>

      {/* Structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
    </article>
  )
}
