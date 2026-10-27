/**
 * Pure helpers that turn a resolved white-label brand into page metadata
 * and assets (no Prisma — unit-testable, Edge-safe).
 *
 * Why this exists: app/layout.tsx carries our marketing SEO metadata
 * (title template '%s | Xovera', OG/Twitter copy, metadataBase
 * xovera.io) and the root file-based icons. Every customer-branded host
 * inherited all of it, so a white-labelled live-help tab read
 * "Xovera — AI Agents for Sales…" with our logo. Segments served on
 * custom hosts (portal, widget, hosted call, Co-Pilot) merge
 * brandMetadata() over the root to replace every key that names us.
 *
 * Icons are NOT set here: file-based metadata (app/icon.svg,
 * app/favicon.ico, app/apple-icon.png, app/opengraph-image.tsx) always
 * wins over a metadata `icons` export, so per-segment icons would be
 * ignored. Instead middleware rewrites those asset paths on custom hosts
 * to /api/brand/* (see brandAssetRewrite in ./hostname.ts).
 */

import type { Metadata } from 'next'

export interface ResolvedBrand {
  /** Shown in the tab title and as the site/app name. */
  name: string
  /** Square-ish image for the favicon; null → generated initial. */
  iconUrl: string | null
  /** #rrggbb accent, used for the generated icon + theme color. */
  accent: string | null
}

const HEX = /^#[0-9a-f]{6}$/i

/** Accent safe to inline into SVG/CSS, else null. */
export function safeAccent(accent: string | null | undefined): string | null {
  const v = (accent ?? '').trim()
  return HEX.test(v) ? v : null
}

/**
 * Readable text colour on `background`: white on dark, near-black on
 * light (WCAG relative luminance, threshold ~0.18 ≈ the crossover where
 * white and black give equal contrast). Non-hex input → white.
 */
export function readableTextOn(background: string | null | undefined): '#ffffff' | '#111111' {
  const hex = safeAccent(background)
  if (!hex) return '#ffffff'
  const ch = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
  return lum > 0.179 ? '#111111' : '#ffffff'
}

/** Trimmed, length-capped brand name; '' when unusable. */
export function cleanBrandName(name: string | null | undefined): string {
  return (name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
}

/**
 * Metadata for a page served under a customer's brand. `origin` is the
 * request's own https origin, so canonical/OG URLs resolve to the
 * customer's host instead of xovera.io.
 */
export function brandMetadata(brand: ResolvedBrand, origin: string | null): Metadata {
  const name = cleanBrandName(brand.name) || 'Support'
  return {
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    // `absolute`, not `default`: a segment's own default title is still
    // wrapped by the PARENT template — the root's '%s | Xovera'. The
    // template here applies to child pages that set their own title.
    title: { absolute: name, template: `%s | ${name}` },
    applicationName: name,
    description: null,
    keywords: null,
    authors: null,
    creator: null,
    publisher: null,
    category: null,
    alternates: { canonical: null },
    openGraph: { type: 'website', siteName: name, title: name },
    twitter: { card: 'summary', title: name },
    appleWebApp: { title: name },
    // Customer-branded surfaces are visitor/session pages, never SEO pages.
    robots: { index: false, follow: false },
  }
}

/** "<page> | <Brand>" for a page that sets its own title in the SAME
 * segment as brandMetadata (the template only reaches child segments). */
export function brandedPageTitle(brand: ResolvedBrand, pageTitle: string): { absolute: string } {
  const name = cleanBrandName(brand.name) || 'Support'
  return { absolute: `${pageTitle} | ${name}` }
}

/** Generated favicon: the brand's initial on its accent color. */
export function brandIconSvg(name: string | null | undefined, accent: string | null | undefined): string {
  const fill = safeAccent(accent) ?? '#52525b'
  const initial = (cleanBrandName(name).match(/[\p{L}\p{N}]/u)?.[0] ?? '').toUpperCase()
  const esc = initial.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="14" fill="${fill}"/>` +
    (esc
      ? `<text x="32" y="44" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="34" font-weight="700" fill="#ffffff">${esc}</text>`
      : '') +
    `</svg>`
  )
}

/** Web app manifest for a branded host (replaces app/manifest.ts there). */
export function brandManifest(brand: ResolvedBrand) {
  const name = cleanBrandName(brand.name) || 'Support'
  const accent = safeAccent(brand.accent) ?? '#18181b'
  return {
    name,
    short_name: name.slice(0, 12),
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: accent,
    icons: [{ src: '/icon.svg', sizes: 'any', type: brand.iconUrl ? undefined : 'image/svg+xml', purpose: 'any' }],
  }
}

// ─── Operator-entered white-label branding (settings → Custom domain) ───

export interface BrandSettings {
  brandName: string | null
  faviconUrl: string | null
  rootUrl: string | null
  /** Team sign-in page + dashboard header logo; null → workspace logo. */
  logoUrl: string | null
  /** #rrggbb for the sign-in page button and generated favicon. */
  accentColor: string | null
  /** #rrggbb for the sign-in button's text; null → automatic contrast. */
  buttonTextColor: string | null
  loginHeading: string | null
  loginMessage: string | null
}

const LOGIN_HEADING_MAX = 80
const LOGIN_MESSAGE_MAX = 500

function optionalText(raw: unknown, field: string, max: number, multiline: boolean): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: `${field} must be text.` }
  const v = multiline
    ? raw.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    : raw.replace(/\s+/g, ' ').trim()
  if (v.length > max) return { ok: false, error: `${field} must be ${max} characters or fewer.` }
  return { ok: true, value: v || null }
}

function optionalUrl(raw: unknown, field: string, httpsOnly: boolean): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, error: `${field} must be a URL.` }
  const v = raw.trim()
  if (!v) return { ok: true, value: null }
  let u: URL
  try { u = new URL(v) } catch { return { ok: false, error: `${field} must be a full URL, like https://example.com.` } }
  const okProto = httpsOnly ? u.protocol === 'https:' : u.protocol === 'https:' || u.protocol === 'http:'
  if (!okProto) return { ok: false, error: `${field} must start with ${httpsOnly ? 'https://' : 'http:// or https://'}.` }
  if (v.length > 2000) return { ok: false, error: `${field} is too long.` }
  return { ok: true, value: u.toString() }
}

/** Validate a PUT body; blank fields clear to null (= fall back). */
export function parseBrandSettings(body: unknown): { ok: true; value: BrandSettings } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (b.brandName !== undefined && b.brandName !== null && typeof b.brandName !== 'string') {
    return { ok: false, error: 'Brand name must be text.' }
  }
  const rawName = typeof b.brandName === 'string' ? b.brandName.replace(/\s+/g, ' ').trim() : ''
  if (rawName.length > 60) return { ok: false, error: 'Brand name must be 60 characters or fewer.' }
  // Favicons render inside our https pages — mixed content is blocked.
  const favicon = optionalUrl(b.faviconUrl, 'Favicon URL', true)
  if (!favicon.ok) return favicon
  const root = optionalUrl(b.rootUrl, 'Homepage redirect', false)
  if (!root.ok) return root
  const logo = optionalUrl(b.logoUrl, 'Logo URL', true)
  if (!logo.ok) return logo
  if (b.accentColor !== undefined && b.accentColor !== null && typeof b.accentColor !== 'string') {
    return { ok: false, error: 'Button colour must be a hex colour like #1d4ed8.' }
  }
  const rawAccent = typeof b.accentColor === 'string' ? b.accentColor.trim() : ''
  const accent = rawAccent ? safeAccent(rawAccent) : null
  if (rawAccent && !accent) return { ok: false, error: 'Button colour must be a hex colour like #1d4ed8.' }
  if (b.buttonTextColor !== undefined && b.buttonTextColor !== null && typeof b.buttonTextColor !== 'string') {
    return { ok: false, error: 'Button text colour must be a hex colour like #ffffff.' }
  }
  const rawText = typeof b.buttonTextColor === 'string' ? b.buttonTextColor.trim() : ''
  const textColor = rawText ? safeAccent(rawText) : null
  if (rawText && !textColor) return { ok: false, error: 'Button text colour must be a hex colour like #ffffff.' }
  const heading = optionalText(b.loginHeading, 'Sign-in heading', LOGIN_HEADING_MAX, false)
  if (!heading.ok) return heading
  const message = optionalText(b.loginMessage, 'Sign-in message', LOGIN_MESSAGE_MAX, true)
  if (!message.ok) return message
  return {
    ok: true,
    value: {
      brandName: rawName || null,
      faviconUrl: favicon.value,
      rootUrl: root.value,
      logoUrl: logo.value,
      accentColor: accent ? accent.toLowerCase() : null,
      buttonTextColor: textColor ? textColor.toLowerCase() : null,
      loginHeading: heading.value,
      loginMessage: message.value,
    },
  }
}
