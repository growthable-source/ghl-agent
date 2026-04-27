import { ImageResponse } from 'next/og'
import { findPostBySlug, POSTS } from '@/lib/blog-posts'

export const runtime = 'edge'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Voxility blog post'

/**
 * Per-post dynamic Open Graph image.
 *
 * Next's `next/og` ImageResponse renders a React tree to a PNG at the
 * edge. Rendered on-demand the first time a crawler (Facebook, LinkedIn,
 * Slack, Twitter) fetches the URL; after that it's cached by Vercel.
 *
 * Design mirrors the site's static OG card but with the post title in
 * place of the generic tagline, so every post gets a social preview
 * that carries its own pitch instead of a one-size-fits-all fallback.
 */
export async function generateStaticParams() {
  return POSTS.map(p => ({ slug: p.slug }))
}

// Next 16 made params a Promise across the metadata file conventions
// — including opengraph-image — so the signature has to unwrap it.
export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const post = findPostBySlug(slug)
  const title = post?.title ?? 'Voxility Blog'
  const category = post?.category ?? 'Guides'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#05080f',
          padding: '72px 80px',
          color: '#f8fafc',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          position: 'relative',
        }}
      >
        {/* Ambient orange glow top-right */}
        <div
          style={{
            position: 'absolute',
            top: -200,
            right: -200,
            width: 600,
            height: 600,
            borderRadius: 600,
            background: 'radial-gradient(circle, rgba(250,77,46,0.35) 0%, rgba(250,77,46,0) 70%)',
            display: 'flex',
          }}
        />

        {/* Category + brand */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1 }}>
          <div
            style={{
              fontSize: 20,
              fontWeight: 600,
              letterSpacing: 2,
              textTransform: 'uppercase',
              color: '#fa4d2e',
              display: 'flex',
            }}
          >
            {category}
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: '#f8fafc',
              display: 'flex',
            }}
          >
            Voxility
          </div>
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: title.length > 60 ? 58 : 72,
            fontWeight: 800,
            lineHeight: 1.08,
            letterSpacing: '-0.02em',
            maxWidth: 1040,
            display: 'flex',
            zIndex: 1,
          }}
        >
          {title}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 22,
            color: '#94a3b8',
            zIndex: 1,
          }}
        >
          <div style={{ display: 'flex' }}>Conversational AI for GoHighLevel &amp; HubSpot</div>
          <div style={{ display: 'flex', color: '#fa4d2e', fontWeight: 600 }}>voxility.ai</div>
        </div>
      </div>
    ),
    { ...size },
  )
}
