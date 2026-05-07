/**
 * Dynamic font loading from the brand-detected font_families.
 *
 * The brand-render Browserbase pass captures the actual computed
 * font-family names from the operator's reference site (top 5 by
 * frequency). This module turns those names into:
 *   1. A Google Fonts CSS URL (server-rendered <link>)
 *   2. CSS variables (--page-font-display + --page-font-body) the
 *      renderer can apply via the existing buildPageThemeStyle
 *
 * Strategy:
 *   - System fonts ("system-ui", "Helvetica", "Arial", etc.) are
 *     applied directly with no Google Fonts load — they already exist
 *     on the user's device.
 *   - Anything else is attempted via Google Fonts. The browser silently
 *     falls back if the family doesn't exist on GF, so misses degrade
 *     gracefully (you get the next-in-stack fallback).
 *
 * The point: a page generated for an Audrey Morris cosmetics funnel
 * should render in Audrey Morris's actual fonts (whatever serif +
 * script they use), not in Inter. Same for a GHL funnel — render in
 * GHL's actual sans-serif, not Inter.
 */

const SYSTEM_FONTS = new Set([
  '-apple-system', 'apple-system', 'system-ui', 'sans-serif', 'serif',
  'monospace', 'inherit', 'helvetica', 'helvetica neue', 'arial', 'verdana',
  'tahoma', 'georgia', 'times', 'times new roman', 'courier', 'courier new',
  'menlo', 'monaco', 'consolas', 'segoe ui', 'roboto', 'sf pro', 'sf pro display',
  'sf pro text', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'blinkmacsystemfont',
])

/** Sanitised font name suitable for a Google Fonts URL. */
function googleFontName(raw: string): string | null {
  const trimmed = raw.trim().replace(/^["']|["']$/g, '').trim()
  if (!trimmed) return null
  if (SYSTEM_FONTS.has(trimmed.toLowerCase())) return null
  // Google Fonts URL format wants spaces as +.
  return trimmed.replace(/\s+/g, '+')
}

export interface BrandFontStyle {
  /** Google Fonts CSS URL to <link rel="stylesheet"> in the page head.
   *  null when no detected fonts need GF (all system or none detected). */
  googleFontsUrl: string | null
  /** CSS to apply on the page wrapper — overrides --page-font-display
   *  and --page-font-body so the existing brand-theme path flows
   *  through unchanged. */
  cssVars: Record<string, string>
}

/**
 * Build a font-loading payload from the brand analysis's detected
 * font_families. Returns the GF URL to inject as `<link>` and CSS
 * vars to merge into the page wrapper's style.
 */
export function brandFontStyleFromAnalysis(
  fontFamilies: string[] | null | undefined,
): BrandFontStyle {
  if (!fontFamilies || fontFamilies.length === 0) {
    return { googleFontsUrl: null, cssVars: {} }
  }
  // Filter to the first ~3 unique candidates that aren't pure system.
  const candidates = fontFamilies
    .map((f) => f.replace(/^["']|["']$/g, '').trim())
    .filter((f) => f.length > 0)
    .slice(0, 3)

  // The "display" font is the first detected (usually the heading
  // family on the source site); body is the second when present, else
  // same as display. Quoted in CSS to handle multi-word names.
  const displayName = candidates[0]
  const bodyName = candidates[1] ?? candidates[0]

  const gfNames = new Set<string>()
  for (const c of candidates) {
    const gf = googleFontName(c)
    if (gf) gfNames.add(gf)
  }
  const googleFontsUrl = gfNames.size > 0
    ? `https://fonts.googleapis.com/css2?${Array.from(gfNames)
        .map((n) => `family=${n}:wght@400;500;600;700;800;900`)
        .join('&')}&display=swap`
    : null

  const cssVars: Record<string, string> = {}
  if (displayName) {
    cssVars['--page-font-display'] = `"${displayName}", var(--font-inter), system-ui, sans-serif`
    cssVars.fontFamily = `"${bodyName}", var(--font-inter), system-ui, sans-serif`
  }
  if (bodyName) {
    cssVars['--page-font-body'] = `"${bodyName}", var(--font-inter), system-ui, sans-serif`
  }

  return { googleFontsUrl, cssVars }
}
