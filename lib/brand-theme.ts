/**
 * Per-page brand-color theming for public landing pages.
 *
 * The AI generator emits `style.primary_color` as a hex like '#0A84FF'.
 * The renderer needs more than just that one hex — buttons need a
 * legible foreground, gradient backdrops want a softer/deeper sibling,
 * and brand tints want low-alpha versions of the same colour. Rather
 * than hard-code a Tailwind palette per page (impossible — colors are
 * runtime values), we derive a small palette here and ship it as a
 * block of CSS custom properties scoped to a single landing page.
 *
 * No `tinycolor` / `chroma-js` dependency on purpose — five lines of
 * arithmetic do everything we need and keep the public bundle lean.
 */

export interface BrandPalette {
  brand: string // input hex, normalised
  brandFg: string // legible text on top of `brand` (#fff or near-black)
  brandSoft: string // ~12% alpha tint of brand — for chips, soft bgs
  brandDeep: string // darker hover variant
  brandGlow: string // 40% alpha — used for shadow glow on big CTAs
}

function clamp(n: number) { return Math.max(0, Math.min(255, Math.round(n))) }

function parseHex(input: string): { r: number; g: number; b: number } {
  let h = input.trim().replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) {
    // Fallback to a neutral indigo if the operator passes garbage.
    return { r: 78, g: 70, b: 229 }
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((n) => clamp(n).toString(16).padStart(2, '0')).join('')
}

/**
 * Relative luminance per WCAG. We use it to pick black vs white as the
 * legible foreground on the brand colour.
 */
function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const norm = (c: number) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * norm(r) + 0.7152 * norm(g) + 0.0722 * norm(b)
}

/** Darken a colour by mixing toward black. amt in [0,1]. */
function darken(rgb: { r: number; g: number; b: number }, amt: number) {
  return { r: rgb.r * (1 - amt), g: rgb.g * (1 - amt), b: rgb.b * (1 - amt) }
}

export function buildBrandPalette(input: string | null | undefined): BrandPalette {
  const rgb = parseHex(input ?? '#0A84FF')
  const brand = toHex(rgb.r, rgb.g, rgb.b)
  const lum = luminance(rgb)
  // Threshold ~0.55 covers most direct-response brand colors. Above that
  // (yellows, light greens), white text fails contrast — flip to black.
  const brandFg = lum > 0.55 ? '#0a0a0a' : '#ffffff'
  const deep = darken(rgb, 0.15)
  return {
    brand,
    brandFg,
    brandSoft: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`,
    brandDeep: toHex(deep.r, deep.g, deep.b),
    brandGlow: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.4)`,
  }
}

/**
 * Returns the inline-style object to apply to the page wrapper. Sets
 * the brand palette as CSS custom properties + the chosen font stacks
 * as `--page-font-body` / `--page-font-display`.
 */
export function buildPageThemeStyle(args: {
  primaryColor?: string | null
  fontFamily?: 'system' | 'serif' | 'display'
  background?: 'white' | 'dark' | 'gradient'
}): React.CSSProperties {
  const p = buildBrandPalette(args.primaryColor)
  // Map the spec's `font_family` onto loaded next/font variables. The
  // public layout (app/p/layout.tsx) loads all three, so swapping is
  // a single-character CSS change rather than a network request.
  const body = args.fontFamily === 'serif' ? 'var(--font-fraunces)' : 'var(--font-inter)'
  const display =
    args.fontFamily === 'serif'
      ? 'var(--font-fraunces)'
      : args.fontFamily === 'display'
        ? 'var(--font-jakarta)'
        : 'var(--font-inter)'
  return {
    // Colour palette
    ['--brand' as string]: p.brand,
    ['--brand-fg' as string]: p.brandFg,
    ['--brand-soft' as string]: p.brandSoft,
    ['--brand-deep' as string]: p.brandDeep,
    ['--brand-glow' as string]: p.brandGlow,
    // Fonts (next/font variables resolve to a real font-family stack)
    ['--page-font-body' as string]: body,
    ['--page-font-display' as string]: display,
    // Always-available script face for [accent]…[/accent] hero markup.
    // Falls back to Brush Script if next/font hasn't loaded.
    ['--page-font-script' as string]: 'var(--font-allura), "Brush Script MT", cursive',
    // Body font on the wrapper itself; display font is opt-in per-element
    fontFamily: body,
  }
}

/**
 * Top-level page-background CSS. Returned separately because we need
 * to apply it to <main> rather than the theme wrapper (so the bg
 * extends edge-to-edge regardless of nested layout choices).
 */
export function buildPageBackgroundStyle(
  background: 'white' | 'dark' | 'gradient' | undefined,
): React.CSSProperties {
  // CSS vars `--page-bg` and `--section-alt-bg` are read by the section
  // components so they swap their hardcoded `#fafafa` / `#0a0a0a`
  // shells when the page is dark vs light. Without these, a dark
  // page would still have light-grey proof + guarantee sections,
  // breaking visual consistency.
  switch (background) {
    case 'dark':
      return {
        background: '#0a0a0a',
        color: '#f5f5f5',
        ['--page-bg' as string]: '#0a0a0a',
        ['--page-fg' as string]: '#f5f5f5',
        ['--section-alt-bg' as string]: '#111317',
        ['--section-alt-fg' as string]: '#f5f5f5',
        ['--section-card-bg' as string]: 'rgba(255,255,255,0.04)',
        ['--section-card-border' as string]: 'rgba(255,255,255,0.08)',
        ['--section-muted-fg' as string]: 'rgba(255,255,255,0.65)',
      }
    case 'gradient':
      return {
        background:
          'radial-gradient(1200px 600px at 10% -10%, var(--brand-soft), transparent 60%), radial-gradient(900px 500px at 110% 10%, var(--brand-soft), transparent 60%), #fafafa',
        color: '#0a0a0a',
        ['--page-bg' as string]: '#fafafa',
        ['--page-fg' as string]: '#0a0a0a',
        ['--section-alt-bg' as string]: '#f5f5f5',
        ['--section-alt-fg' as string]: '#0a0a0a',
        ['--section-card-bg' as string]: '#ffffff',
        ['--section-card-border' as string]: 'rgba(0,0,0,0.06)',
        ['--section-muted-fg' as string]: 'rgba(0,0,0,0.65)',
      }
    default:
      return {
        background: '#ffffff',
        color: '#0a0a0a',
        ['--page-bg' as string]: '#ffffff',
        ['--page-fg' as string]: '#0a0a0a',
        ['--section-alt-bg' as string]: '#fafafa',
        ['--section-alt-fg' as string]: '#0a0a0a',
        ['--section-card-bg' as string]: '#ffffff',
        ['--section-card-border' as string]: 'rgba(0,0,0,0.06)',
        ['--section-muted-fg' as string]: 'rgba(0,0,0,0.65)',
      }
  }
}
