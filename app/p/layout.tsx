/**
 * Public landing-page layout (Voxility-hosted /p/<slug> routes).
 *
 * Loads Inter (body) + Fraunces (serif display) + Plus Jakarta Sans
 * (geometric display) via next/font so AI-generated landing pages can
 * pick a typography style without runtime font fetches. Exposes them
 * as CSS variables so the per-page renderer can map `style.font_family`
 * onto `--page-font-body` / `--page-font-display`.
 *
 * Deliberately distinct from the dashboard's DM Sans — landing pages
 * deserve their own visual identity, and serving DM Sans on a public
 * lead-gen page tints every brand the same way.
 */

import { Inter, Fraunces, Plus_Jakarta_Sans } from 'next/font/google'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  display: 'swap',
})

const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin'],
  // 'opsz' is Fraunces' optical-sizing axis — letting it auto-size by
  // viewport gives big display headlines real warmth instead of looking
  // like a stretched body face.
  axes: ['opsz', 'SOFT'],
  weight: ['400', '500', '600', '700', '900'],
  display: 'swap',
})

const jakarta = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
})

export default function PublicLandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${inter.variable} ${fraunces.variable} ${jakarta.variable}`}>
      {children}
    </div>
  )
}
