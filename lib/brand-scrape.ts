/**
 * Server-side reference-website scraper for the brand-kit intake.
 *
 * Operator pastes a URL ("here's our existing site"); we fetch, parse,
 * and extract:
 *   - theme color (from <meta name="theme-color">)
 *   - dominant inline-style colors (CSS-in-HTML pages reveal a lot)
 *   - common <style> block colors
 *   - og:image (we don't use it directly but surface it as a reference
 *     image the operator can opt-in to)
 *   - logo URL guesses (apple-touch-icon, og:image, /favicon.svg)
 *   - body copy snippets the AI can use as voice reference
 *
 * Deliberately lightweight — no headless browser, no JS execution.
 * That misses SPA-rendered styles but works on most marketing sites
 * (which are server-rendered or static for SEO reasons).
 */

interface ScrapeResult {
  ok: true
  url: string
  themeColor: string | null
  extractedColors: string[]
  logoCandidates: string[]
  ogImage: string | null
  textSamples: string[]
}
interface ScrapeFailure { ok: false; error: string }

const HEX = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g
const RGB = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g

const FETCH_TIMEOUT_MS = 8_000
const MAX_BODY_BYTES = 800_000 // ~800KB of HTML is enough for color signal

function normaliseHex(hex: string): string {
  let h = hex.replace('#', '').toLowerCase()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return `#${h}`
}

function hexFromRgb(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, n))
  return '#' + [r, g, b].map((n) => clamp(n).toString(16).padStart(2, '0')).join('')
}

/** Skip near-white, near-black, and near-grey colors — they're chrome,
 *  not brand. Returns true if the colour carries brand signal. */
function isBrandLike(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const lum = (r + g + b) / 3
  // Drop near-black (< 25), near-white (> 235), near-grey (max-min < 18).
  if (lum < 25 || lum > 235) return false
  if (max - min < 18) return false
  return true
}

function rankColors(html: string): string[] {
  const counts = new Map<string, number>()
  for (const m of html.matchAll(HEX)) {
    const h = normaliseHex(m[0])
    if (!isBrandLike(h)) continue
    counts.set(h, (counts.get(h) ?? 0) + 1)
  }
  for (const m of html.matchAll(RGB)) {
    const h = hexFromRgb(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10))
    if (!isBrandLike(h)) continue
    counts.set(h, (counts.get(h) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([hex]) => hex)
}

function metaContent(html: string, name: string): string | null {
  // Tolerant attribute order — `name=` and `content=` may appear either way.
  const reA = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i')
  const reB = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i')
  return html.match(reA)?.[1] ?? html.match(reB)?.[1] ?? null
}

function metaProperty(html: string, prop: string): string | null {
  const reA = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i')
  const reB = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i')
  return html.match(reA)?.[1] ?? html.match(reB)?.[1] ?? null
}

function linkHref(html: string, rel: string): string | null {
  const re = new RegExp(`<link[^>]+rel=["'][^"']*\\b${rel}\\b[^"']*["'][^>]+href=["']([^"']+)["']`, 'i')
  return html.match(re)?.[1] ?? null
}

function absoluteUrl(href: string | null, base: string): string | null {
  if (!href) return null
  try {
    return new URL(href, base).toString()
  } catch {
    return null
  }
}

/** Pull a few headline-y body strings — h1, h2, og:description. The
 *  generator uses these as a voice reference, NOT to copy verbatim. */
function extractCopySamples(html: string): string[] {
  const samples: string[] = []
  const ogDesc = metaProperty(html, 'og:description') ?? metaContent(html, 'description')
  if (ogDesc) samples.push(ogDesc.trim())
  const headlines = [...html.matchAll(/<(?:h1|h2)[^>]*>([\s\S]*?)<\/(?:h1|h2)>/gi)].slice(0, 6)
  for (const m of headlines) {
    const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    if (text.length >= 8 && text.length <= 200) samples.push(text)
  }
  return samples.slice(0, 8)
}

export async function scrapeBrandFromUrl(rawUrl: string): Promise<ScrapeResult | ScrapeFailure> {
  let url: URL
  try {
    url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
  } catch {
    return { ok: false, error: 'Invalid URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only http/https URLs are allowed.' }
  }
  // Block link-local / loopback to avoid SSRF — operators should not be
  // pointing the scraper at their internal infra.
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01]))/i.test(url.hostname)) {
    return { ok: false, error: 'Local/private addresses are blocked.' }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        // Pretend to be a normal browser — many sites 403 on bare fetches.
        'User-Agent': 'Mozilla/5.0 (compatible; VoxilityBrandScraper/1.0; +https://voxility.ai)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
      redirect: 'follow',
    })
  } catch (err) {
    clearTimeout(timeoutId)
    return { ok: false, error: err instanceof Error ? err.message : 'fetch_failed' }
  }
  clearTimeout(timeoutId)

  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('html')) return { ok: false, error: `Non-HTML response (${ct || 'unknown content-type'})` }

  // Read with a hard cap so a multi-MB SPA doesn't OOM the function.
  const reader = res.body?.getReader()
  if (!reader) return { ok: false, error: 'Empty response body' }
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.length
      if (total >= MAX_BODY_BYTES) break
    }
  }
  const html = new TextDecoder('utf-8', { fatal: false }).decode(
    Buffer.concat(chunks.map((c) => Buffer.from(c))),
  )

  const themeColor = metaContent(html, 'theme-color')
  const extractedColors = rankColors(html)
  const ogImage = absoluteUrl(metaProperty(html, 'og:image'), url.toString())
  const logoCandidates = [
    absoluteUrl(linkHref(html, 'apple-touch-icon'), url.toString()),
    absoluteUrl(linkHref(html, 'icon'), url.toString()),
    ogImage,
  ].filter((x): x is string => !!x)

  return {
    ok: true,
    url: url.toString(),
    themeColor: themeColor && /^#?[0-9a-fA-F]{3,8}$/.test(themeColor) ? themeColor : null,
    extractedColors,
    logoCandidates,
    ogImage,
    textSamples: extractCopySamples(html),
  }
}
