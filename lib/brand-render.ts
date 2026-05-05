/**
 * Real-browser page renderer for the brand-kit pipeline.
 *
 * Replaces the regex-over-HTML scraper (still around as a fallback) with
 * a Chromium session running on Browserbase. The point isn't speed —
 * it's that we can finally see what the operator's site actually looks
 * like AFTER JS executes (handles SPAs, lazy-loaded fonts, computed
 * styles), screenshot it, and feed that screenshot to a vision LLM.
 *
 * Architecture:
 *   1. POST /sessions to Browserbase to spin up a fresh Chromium VM.
 *   2. Connect to it via Playwright over the returned WebSocket URL.
 *   3. Navigate, wait for network idle, screenshot.
 *   4. Pull rendered HTML, computed-style brand colours, og metadata.
 *   5. Close the session (otherwise it accrues minutes against quota).
 *
 * Returns base64 screenshot bytes — the caller is responsible for
 * persisting to Vercel Blob (so we can also pass the URL to Gemini
 * later as a visual reference image).
 *
 * Auth: BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID. If either is
 * missing, isBrowserRenderEnabled() returns false and the caller
 * falls back to the regex scraper.
 */

import { chromium } from 'playwright-core'

interface RenderResult {
  ok: true
  finalUrl: string
  title: string
  screenshotBase64: string
  /** PNG mime by default — Playwright defaults to PNG. */
  screenshotMime: 'image/png'
  /** Rendered HTML (post-JS) so the caller can still do regex passes
   *  for og:image, manifest theme-color, etc. */
  html: string
  /** Computed-style colour signal collected via in-page JS. Far more
   *  accurate than HTML regex — this captures Tailwind's compiled
   *  rgb() values, computed CSS variables, etc. */
  computedColors: string[]
  /** Body text snippets the operator's site actually shows visitors. */
  textSamples: string[]
  /** Detected font families from computed styles, ranked by frequency. */
  fontFamilies: string[]
}

interface RenderFailure { ok: false; error: string }

const FETCH_TIMEOUT_MS = 25_000
const MAX_BODY_BYTES = 800_000

export function isBrowserRenderEnabled(): boolean {
  return !!(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID)
}

export async function renderUrl(rawUrl: string): Promise<RenderResult | RenderFailure> {
  let url: URL
  try {
    url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
  } catch {
    return { ok: false, error: 'Invalid URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only http/https URLs are allowed.' }
  }
  // SSRF guard — same as the regex scraper. Browserbase runs in their
  // cloud so this is belt-and-braces, but cheap.
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01]))/i.test(url.hostname)) {
    return { ok: false, error: 'Local/private addresses are blocked.' }
  }

  const apiKey = process.env.BROWSERBASE_API_KEY
  const projectId = process.env.BROWSERBASE_PROJECT_ID
  if (!apiKey || !projectId) return { ok: false, error: 'Browserbase not configured (BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID).' }

  // ─── 1. Spin up a Browserbase session ──────────────────────────────
  // Direct REST call rather than @browserbasehq/sdk so this file stays
  // ~100 lines and the SDK's transitive deps don't bloat the function
  // bundle. Same shape as the SDK's sessions.create() call.
  let connectUrl: string
  let sessionId: string
  try {
    const res = await fetch('https://api.browserbase.com/v1/sessions', {
      method: 'POST',
      headers: { 'X-BB-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, browserSettings: { viewport: { width: 1440, height: 900 } } }),
    })
    if (!res.ok) {
      return { ok: false, error: `Browserbase session create failed: HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 200))}` }
    }
    const data = (await res.json()) as { id: string; connectUrl: string }
    connectUrl = data.connectUrl
    sessionId = data.id
  } catch (err) {
    return { ok: false, error: `Browserbase session create failed: ${err instanceof Error ? err.message : 'unknown'}` }
  }

  // ─── 2. Drive the session via Playwright ───────────────────────────
  let browser
  try {
    browser = await chromium.connectOverCDP(connectUrl)
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const page = context.pages()[0] ?? (await context.newPage())

    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (compatible; VoxilityBrandRenderer/1.0; +https://voxility.ai)',
    })
    await page.goto(url.toString(), {
      waitUntil: 'networkidle',
      timeout: FETCH_TIMEOUT_MS,
    })

    const finalUrl = page.url()
    const title = await page.title().catch(() => '')
    const screenshotBuffer = await page.screenshot({
      type: 'png',
      // First-fold only — the hero is what tells us about the brand.
      // Full page screenshots also balloon to multi-MB which Gemini
      // refuses as input.
      fullPage: false,
    })

    const html = (await page.content()).slice(0, MAX_BODY_BYTES)

    // ─── 3. Pull computed-style brand signal via in-page JS ──────────
    // Walks visible elements, collects background-color + color +
    // border-color + font-family from their computedStyle. Far more
    // useful than regex over HTML because Tailwind/CSS-in-JS resolves
    // to real rgb() values here.
    const signal = await page.evaluate(() => {
      function isVisible(el: Element): boolean {
        const cs = window.getComputedStyle(el)
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false
        const r = (el as HTMLElement).getBoundingClientRect()
        return r.width > 0 && r.height > 0
      }
      const colorCounts = new Map<string, number>()
      const fontCounts = new Map<string, number>()
      const headlines: string[] = []
      const ALL = Array.from(document.body.querySelectorAll('*')).slice(0, 1500)
      for (const el of ALL) {
        if (!isVisible(el)) continue
        const cs = window.getComputedStyle(el)
        for (const prop of ['color', 'backgroundColor', 'borderTopColor'] as const) {
          const v = cs[prop]
          if (v && v !== 'rgba(0, 0, 0, 0)' && v !== 'transparent') {
            colorCounts.set(v, (colorCounts.get(v) ?? 0) + 1)
          }
        }
        const ff = cs.fontFamily
        if (ff) {
          // Take just the first font in the stack — that's the brand pick.
          const first = ff.split(',')[0]!.trim().replace(/^["']|["']$/g, '')
          fontCounts.set(first, (fontCounts.get(first) ?? 0) + 1)
        }
        const tag = el.tagName
        if ((tag === 'H1' || tag === 'H2') && headlines.length < 8) {
          const t = (el as HTMLElement).innerText.trim().replace(/\s+/g, ' ')
          if (t.length >= 8 && t.length <= 200) headlines.push(t)
        }
      }
      const topColors = Array.from(colorCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k)
      const topFonts = Array.from(fontCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k)
      // og:description as a 9th text sample if present.
      const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content')
        ?? document.querySelector('meta[name="description"]')?.getAttribute('content')
      if (ogDesc) headlines.unshift(ogDesc.trim())
      return { colors: topColors, fonts: topFonts, headlines: headlines.slice(0, 8) }
    })

    return {
      ok: true,
      finalUrl,
      title,
      screenshotBase64: screenshotBuffer.toString('base64'),
      screenshotMime: 'image/png',
      html,
      computedColors: convertCssColorsToHex(signal.colors),
      fontFamilies: signal.fonts,
      textSamples: signal.headlines,
    }
  } catch (err) {
    return { ok: false, error: `Render failed: ${err instanceof Error ? err.message : 'unknown'}` }
  } finally {
    try { await browser?.close() } catch { /* swallow */ }
    // Best-effort session close — Browserbase auto-reaps idle sessions
    // but releasing eagerly keeps quota tidy.
    fetch(`https://api.browserbase.com/v1/sessions/${sessionId}`, {
      method: 'POST',
      headers: { 'X-BB-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'REQUEST_RELEASE' }),
    }).catch(() => {})
  }
}

/** Convert Playwright's `rgb(r, g, b)` / `rgba(r, g, b, a)` strings to
 *  hex, dropping transparent colours. Drops near-white/near-black/grey
 *  so the caller gets brand-relevant signal only. */
function convertCssColorsToHex(cssColors: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const css of cssColors) {
    const m = css.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/)
    if (!m) continue
    const r = +m[1], g = +m[2], b = +m[3]
    const lum = (r + g + b) / 3
    if (lum < 25 || lum > 235) continue
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    if (max - min < 18) continue
    const hex = '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')
    if (seen.has(hex)) continue
    seen.add(hex)
    out.push(hex)
  }
  return out
}
