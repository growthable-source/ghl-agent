import { ImageResponse } from 'next/og'

/**
 * Homepage Open Graph card. Rendered dynamically by next/og so the brand
 * mark + wordmark always match the current identity (no stale raster to
 * regenerate on a rebrand). Marketing sub-pages use lib/og-template.tsx.
 */
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Xovera — AI Agents for Sales & Marketing Teams'

// Waveform bars (heights as a fraction of the circle), matching the brand mark.
const BARS = [0.34, 0.62, 1, 0.62, 0.34]

export default function Og() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0a0d18',
          padding: '80px',
          color: '#f8fafc',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: -180,
            right: -160,
            width: 620,
            height: 620,
            borderRadius: 620,
            background: 'radial-gradient(circle, rgba(239,65,54,0.30) 0%, rgba(239,65,54,0) 70%)',
            display: 'flex',
          }}
        />
        {/* Lockup: mark + wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 28, zIndex: 1 }}>
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: 999,
              border: '7px solid #f15a36',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 9,
            }}
          >
            {BARS.map((h, i) => (
              <div
                key={i}
                style={{
                  width: 9,
                  height: Math.round(64 * h),
                  borderRadius: 9,
                  background: i % 2 === 0 ? '#fbb040' : '#f15a36',
                  display: 'flex',
                }}
              />
            ))}
          </div>
          <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: '-3px', display: 'flex' }}>Xovera</div>
        </div>

        <div
          style={{
            fontSize: 64,
            fontWeight: 800,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            maxWidth: 960,
            display: 'flex',
            zIndex: 1,
          }}
        >
          AI agents for sales &amp; marketing teams
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 24,
            color: '#94a3b8',
            zIndex: 1,
          }}
        >
          <div style={{ display: 'flex' }}>Answer calls, reply to texts, book appointments — automatically.</div>
          <div style={{ display: 'flex', color: '#f15a36', fontWeight: 600 }}>xovera.io</div>
        </div>
      </div>
    ),
    { ...size },
  )
}
