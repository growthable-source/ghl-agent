/**
 * Renders one of OUR landing pages in a real browser via Browserbase
 * and screenshots it. Used by the build-orchestrator to feed the vision
 * critic — "what does the page actually look like?" — instead of trusting
 * the spec is correct.
 *
 * Two screenshots: first-fold (1440x900, hero impression) and full-page
 * (whole scroll, layout flow). Both as base64 PNG so they can stream
 * straight into Anthropic vision messages without a Blob round-trip.
 *
 * Also captures console + network errors during the load — broken hero
 * images, 404 fonts, runtime exceptions all feed back into the critic
 * so it can flag them as "critical" without the model having to infer
 * from pixels.
 *
 * Auth: same BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID as brand-render.
 */

import { chromium } from 'playwright-core'

interface PageRenderResult {
  ok: true
  finalUrl: string
  /** First-fold (1440x900) screenshot. PNG bytes, base64. */
  firstFoldBase64: string
  /** Full-page (1440 wide, scroll-height tall) screenshot. PNG, base64. */
  fullPageBase64: string
  screenshotMime: 'image/png'
  /** Console error/warning messages observed during load. Truncated. */
  consoleErrors: string[]
  /** URLs that returned 4xx/5xx during load. Reveals broken hero images,
   *  404 fonts, missing API endpoints. */
  networkErrors: Array<{ url: string; status: number }>
  /** Pixel height of the rendered document. Useful as a sanity check —
   *  pages under ~600px tall usually mean a render error. */
  documentHeight: number
}

interface PageRenderFailure { ok: false; error: string }

const NAV_TIMEOUT_MS = 30_000

export async function renderLandingPage(rawUrl: string): Promise<PageRenderResult | PageRenderFailure> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return { ok: false, error: 'Invalid URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only http/https URLs are allowed.' }
  }

  const apiKey = process.env.BROWSERBASE_API_KEY
  const projectId = process.env.BROWSERBASE_PROJECT_ID
  if (!apiKey || !projectId) {
    return { ok: false, error: 'Browserbase not configured (BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID).' }
  }

  let connectUrl: string
  let sessionId: string
  try {
    const res = await fetch('https://api.browserbase.com/v1/sessions', {
      method: 'POST',
      headers: { 'X-BB-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, browserSettings: { viewport: { width: 1440, height: 900 } } }),
    })
    if (!res.ok) {
      const body = await res.text().then((t) => t.slice(0, 200)).catch(() => '')
      return { ok: false, error: `Browserbase session create failed: HTTP ${res.status} ${body}` }
    }
    const data = (await res.json()) as { id: string; connectUrl: string }
    connectUrl = data.connectUrl
    sessionId = data.id
  } catch (err) {
    return { ok: false, error: `Browserbase session create failed: ${err instanceof Error ? err.message : 'unknown'}` }
  }

  let browser
  try {
    browser = await chromium.connectOverCDP(connectUrl)
    const context = browser.contexts()[0] ?? (await browser.newContext())
    const page = context.pages()[0] ?? (await context.newPage())

    const consoleErrors: string[] = []
    const networkErrors: Array<{ url: string; status: number }> = []

    page.on('console', (msg) => {
      const t = msg.type()
      if (t === 'error' || t === 'warning') {
        const text = msg.text().slice(0, 240)
        if (text) consoleErrors.push(`[${t}] ${text}`)
      }
    })
    page.on('pageerror', (err) => {
      consoleErrors.push(`[pageerror] ${err.message.slice(0, 240)}`)
    })
    page.on('response', (res) => {
      const status = res.status()
      if (status >= 400) {
        networkErrors.push({ url: res.url().slice(0, 200), status })
      }
    })

    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (compatible; VoxilityBuildLoop/1.0; +https://voxility.ai)',
    })

    await page.goto(url.toString(), { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS })

    const finalUrl = page.url()
    const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight)

    const firstFold = await page.screenshot({ type: 'png', fullPage: false })
    // Anthropic vision API rejects images with any dimension > 8000px.
    // Long landing pages (hero + problem + mechanism + proof + offer +
    // guarantee + faq + footer) routinely scroll to 9000-12000px,
    // which used to land as `400 invalid_request_error: At least one
    // of the image dimensions exceed max allowed size: 8000 pixels`.
    // Clip the capture at 7800px to stay safely under the limit. The
    // critic loses visibility into the bottom of pathologically long
    // pages, which is fine — those pages are usually broken anyway
    // and the critic should flag length itself as a problem.
    const FULL_PAGE_MAX_HEIGHT = 7800
    const fullPage = await page.screenshot({
      type: 'png',
      fullPage: true,
      clip: documentHeight > FULL_PAGE_MAX_HEIGHT
        ? { x: 0, y: 0, width: 1440, height: FULL_PAGE_MAX_HEIGHT }
        : undefined,
    })

    return {
      ok: true,
      finalUrl,
      firstFoldBase64: firstFold.toString('base64'),
      fullPageBase64: fullPage.toString('base64'),
      screenshotMime: 'image/png',
      consoleErrors: consoleErrors.slice(0, 30),
      networkErrors: networkErrors.slice(0, 30),
      documentHeight,
    }
  } catch (err) {
    return { ok: false, error: `Render failed: ${err instanceof Error ? err.message : 'unknown'}` }
  } finally {
    try { await browser?.close() } catch { /* swallow */ }
    fetch(`https://api.browserbase.com/v1/sessions/${sessionId}`, {
      method: 'POST',
      headers: { 'X-BB-API-Key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'REQUEST_RELEASE' }),
    }).catch(() => {})
  }
}
