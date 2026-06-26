/**
 * Public landing-page layout (Xovera-hosted /p/<slug> routes).
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

import { Inter, Fraunces, Plus_Jakarta_Sans, Allura } from 'next/font/google'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  display: 'swap',
})

const fraunces = Fraunces({
  variable: '--font-fraunces',
  subsets: ['latin'],
  // Loaded as a fully-variable font (no explicit weight array) so CSS
  // can pick any weight 100–900 at use site, AND so we can opt into
  // the 'opsz' (optical sizing) and 'SOFT' axes — next/font requires
  // weight to be unset/'variable' before `axes` is allowed.
  axes: ['opsz', 'SOFT'],
  display: 'swap',
})

const jakarta = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
})

// Allura — formal script face used for hero-headline [accent]…[/accent]
// markup (the Manus-style emotional anchor like "Beauty Brand" set in
// red script). Single weight is enough — script faces aren't varied
// across the page.
const allura = Allura({
  variable: '--font-allura',
  subsets: ['latin'],
  weight: ['400'],
  display: 'swap',
})

export default function PublicLandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div id="vox-public-page" className={`${inter.variable} ${fraunces.variable} ${jakarta.variable} ${allura.variable}`}>
      {/* CSS isolation against dashboard global overrides.
          app/globals.css repaints .bg-white → --btn-primary-bg (orange
          CTA), .bg-zinc-* → --surface-* (themed dark surfaces) etc.
          Those rules are scoped via :root:not(...):not(...):not(...) for
          (0,4,0) specificity — to beat them inside the public landing
          scope we use ID-prefixed selectors for (1,1,0) specificity,
          which wins regardless of the dashboard's !important.
          Without this every form card on /p/<slug> renders Xovera
          orange, every "white" surface comes out themed, etc. */}
      <style>{`
        #vox-public-page .bg-white { background-color: #ffffff !important; }
        #vox-public-page .bg-zinc-50 { background-color: #fafafa !important; }
        #vox-public-page .bg-zinc-100 { background-color: #f4f4f5 !important; }
        #vox-public-page .bg-zinc-800 { background-color: #27272a !important; }
        #vox-public-page .bg-zinc-900 { background-color: #18181b !important; }
        #vox-public-page .bg-zinc-950 { background-color: #09090b !important; }
        #vox-public-page .text-zinc-400 { color: #a1a1aa !important; }
        #vox-public-page .text-zinc-500 { color: #71717a !important; }
        #vox-public-page .text-zinc-600 { color: #52525b !important; }
        #vox-public-page .text-zinc-700 { color: #3f3f46 !important; }
        #vox-public-page .text-zinc-800 { color: #27272a !important; }
        #vox-public-page .text-zinc-900 { color: #18181b !important; }
      `}</style>
      {children}
    </div>
  )
}
