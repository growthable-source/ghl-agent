import { ImageResponse } from 'next/og'

/**
 * Shared Open Graph card for marketing pages (alternatives + solutions).
 * Social cards stay on the premium dark treatment regardless of the
 * light page theme. Each route's opengraph-image.tsx calls marketingOg()
 * with its eyebrow + title.
 */
export const OG_SIZE = { width: 1200, height: 630 }
export const OG_CONTENT_TYPE = 'image/png'

export function marketingOg({ eyebrow, title }: { eyebrow: string; title: string }) {
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: 2, textTransform: 'uppercase', color: '#fa4d2e', display: 'flex' }}>
            {eyebrow}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#f8fafc', display: 'flex' }}>Xovera</div>
        </div>
        <div style={{ fontSize: title.length > 60 ? 56 : 70, fontWeight: 800, lineHeight: 1.08, letterSpacing: '-0.02em', maxWidth: 1040, display: 'flex', zIndex: 1 }}>
          {title}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 22, color: '#94a3b8', zIndex: 1 }}>
          <div style={{ display: 'flex' }}>AI agents for sales &amp; marketing teams</div>
          <div style={{ display: 'flex', color: '#fa4d2e', fontWeight: 600 }}>xovera.io</div>
        </div>
      </div>
    ),
    { ...OG_SIZE },
  )
}
