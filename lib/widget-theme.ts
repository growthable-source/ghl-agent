/**
 * Widget conversation theme.
 *
 * The chat widget used to be a hardcoded dark theme (bg-zinc-950 /
 * text-zinc-100) with only the brand accent configurable — so a widget
 * whose owner wanted a light or custom look got unreadable text (black
 * on black, or the fixed near-white text on a light background).
 *
 * This derives a full, legible conversation palette from two optional
 * inputs — a background colour and a text colour — so a user can pick
 * black/white (or anything) and still get a readable widget:
 *
 *  - backgroundColor unset  → the original near-black (#09090b), so an
 *    existing widget looks byte-for-byte identical.
 *  - textColor unset        → auto-computed for WCAG contrast against
 *    the background (dark bg → near-white text, light bg → near-black),
 *    which is the "never broken" default.
 *  - textColor set          → used verbatim (explicit override wins).
 *
 * Everything else (elevated bubble/input surface, muted secondary text,
 * borders) is mixed from those two so light and dark both look intentional.
 * Pure + unit-tested; the embed maps the result onto CSS variables.
 */

export interface WidgetThemeInput {
  backgroundColor?: string | null
  textColor?: string | null
}

export interface WidgetTheme {
  /** Conversation background. */
  bg: string
  /** Primary conversation text. */
  fg: string
  /** Elevated surface — agent bubbles, the input box. */
  surface: string
  /** Muted secondary text — subtitles, timestamps, system lines. */
  muted: string
  /** Hairline borders / dividers. */
  border: string
}

// The historical dark defaults — reproduced exactly when nothing is set.
const DEFAULT_BG = '#09090b' // zinc-950
const DARK_FG = '#f4f4f5'    // zinc-100
const LIGHT_FG = '#0a0a0a'

interface RGB { r: number; g: number; b: number }

function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null
  let h = input.trim().replace(/^#/, '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return /^[0-9a-fA-F]{6}$/.test(h) ? `#${h.toLowerCase()}` : null
}

function parseHex(input: string | null | undefined, fallback: RGB): RGB {
  const h = normalizeHex(input)
  if (!h) return fallback
  const s = h.slice(1)
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  }
}

function toHex({ r, g, b }: RGB): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function luminance(c: RGB): number {
  const chan = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b)
}

/** Linear interpolation between two colours (t: 0 = from, 1 = to). */
function mix(from: RGB, to: RGB, t: number): RGB {
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t,
  }
}

const BLACK: RGB = { r: 10, g: 10, b: 10 }
const WHITE: RGB = { r: 245, g: 245, b: 245 }

/** Near-white or near-black for legible text on `bg`. */
export function autoTextColor(bg: RGB): string {
  return luminance(bg) > 0.5 ? LIGHT_FG : DARK_FG
}

export function buildWidgetTheme(input: WidgetThemeInput): WidgetTheme {
  const bg = parseHex(input.backgroundColor, parseHex(DEFAULT_BG, BLACK))
  const isLight = luminance(bg) > 0.5

  // Explicit, VALID text override wins; anything else (unset, blank,
  // unparseable) falls back to auto-contrast.
  const override = normalizeHex(input.textColor)
  const fgHex = override ?? autoTextColor(bg)
  const fg = parseHex(fgHex, isLight ? BLACK : WHITE)

  // Elevated surface (agent bubble, input): nudge the background toward
  // its opposite so bubbles read as raised on both light and dark.
  const surface = isLight ? mix(bg, BLACK, 0.06) : mix(bg, WHITE, 0.10)
  // Secondary text: between bg and fg, closer to fg so it stays legible.
  const muted = mix(bg, fg, 0.55)
  // Hairline: mostly background with a hint of foreground.
  const border = mix(bg, fg, 0.14)

  return {
    bg: toHex(bg),
    fg: toHex(fg),
    surface: toHex(surface),
    muted: toHex(muted),
    border: toHex(border),
  }
}
