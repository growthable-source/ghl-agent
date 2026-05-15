/**
 * Docs / help-center adapter — Firecrawl-backed.
 *
 * Why Firecrawl over Crawl4AI / Browserless / DIY headless Chrome:
 *   - Handles JS rendering, anti-bot, rate limits without ops surface
 *   - Returns clean markdown, not raw HTML — boilerplate (nav, footer,
 *     cookie banners) already stripped by their extractor
 *   - REST API, no SDK dependency — keeps our build slim
 *
 * crawl_config shape this adapter accepts:
 *   {
 *     recrawlIntervalDays: number  (default 7)
 *     includeSubpaths:     string[] (optional — extra URLs to seed alongside discovered ones)
 *     excludePatterns:     string[] (regex patterns; URLs matching are dropped)
 *     maxPages:            number  (default 50, capped at 200 to keep credit use sane)
 *     recursive:           boolean (default true — set false to scrape only the root URL)
 *   }
 *
 * discover() now uses Firecrawl's /v1/map to enumerate every URL
 * reachable from the root, applies excludePatterns, and caps at
 * maxPages. Originally returned just the root + explicit subpaths;
 * operators expected "paste a help center, get every page" so we
 * default to recursive discovery.
 */

import type { SourceAdapter, DiscoveredItem, RawContent, NormalizedContent, AdapterContext } from './types'

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1'

const DEFAULT_MAX_PAGES = 50
const HARD_MAX_PAGES = 200

interface DocsCrawlConfig {
  recrawlIntervalDays?: number
  includeSubpaths?: string[]
  excludePatterns?: string[]
  maxPages?: number
  recursive?: boolean
}

interface FirecrawlScrapeResponse {
  success: boolean
  data?: {
    markdown?: string
    metadata?: {
      title?: string
      sourceURL?: string
      ogTitle?: string
      publishedTime?: string
      modifiedTime?: string
    }
  }
  error?: string
}

interface FirecrawlMapResponse {
  success: boolean
  links?: string[]
  error?: string
}

export const docsFirecrawlAdapter: SourceAdapter = {
  sourceType: 'docs',

  async discover(ctx: AdapterContext): Promise<DiscoveredItem[]> {
    const cfg = ctx.source.crawlConfig as DocsCrawlConfig
    const root = ctx.source.urlOrIdentifier
    const recursive = cfg.recursive !== false // default ON
    const maxPages = Math.max(1, Math.min(HARD_MAX_PAGES, cfg.maxPages ?? DEFAULT_MAX_PAGES))
    const explicit = (cfg.includeSubpaths ?? []).filter(u => typeof u === 'string' && u.length > 0)

    // Compile exclude patterns once. Invalid regex strings are
    // silently dropped — better than failing the whole crawl.
    const excludeRegexes: RegExp[] = []
    for (const pattern of cfg.excludePatterns ?? []) {
      try { excludeRegexes.push(new RegExp(pattern)) } catch { /* ignore */ }
    }

    let discovered: string[] = [root, ...explicit]

    if (recursive) {
      try {
        const mapped = await firecrawlMap(root)
        if (mapped.length > 0) {
          discovered = [root, ...mapped, ...explicit]
        }
      } catch (err: any) {
        console.warn('[docs-firecrawl] /map failed, falling back to root URL only:', err?.message)
        // We swallow rather than throw — the operator gets at least
        // the root page indexed. The IngestionRun's errorLog at the
        // discover stage would otherwise show this same message.
      }
    }

    // Dedupe (preserve order), strip excluded URLs, cap at maxPages.
    const seen = new Set<string>()
    const out: DiscoveredItem[] = []
    for (const url of discovered) {
      if (!url || seen.has(url)) continue
      if (excludeRegexes.some(re => re.test(url))) continue
      seen.add(url)
      out.push({ identifier: url })
      if (out.length >= maxPages) break
    }
    return out
  },

  async fetch(_ctx: AdapterContext, item: DiscoveredItem): Promise<RawContent> {
    const apiKey = process.env.FIRECRAWL_API_KEY
    if (!apiKey) {
      throw new Error('FIRECRAWL_API_KEY env var not set — docs adapter unavailable.')
    }

    const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: item.identifier,
        formats: ['markdown'],
        onlyMainContent: true,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Firecrawl ${res.status}: ${text.slice(0, 300)}`)
    }
    const json = await res.json() as FirecrawlScrapeResponse
    if (!json.success || !json.data?.markdown) {
      throw new Error(`Firecrawl returned no markdown for ${item.identifier}: ${json.error || 'unknown'}`)
    }
    return {
      identifier: item.identifier,
      raw: json.data,
      fetchedAt: new Date(),
    }
  },

  async normalize(_ctx: AdapterContext, raw: RawContent): Promise<NormalizedContent> {
    const data = raw.raw as FirecrawlScrapeResponse['data']
    if (!data) throw new Error('normalize: empty raw payload')

    const markdown = (data.markdown ?? '').trim()
    if (!markdown) throw new Error('normalize: empty markdown after extraction')

    const sourceUrl = data.metadata?.sourceURL || raw.identifier
    const title = data.metadata?.title || data.metadata?.ogTitle || sourceUrl

    // Build breadcrumb_path from the URL path segments. Firecrawl
    // doesn't return one; deriving from path is good enough for
    // surfacing context in the inbox + retrieval ("docs > workflows > triggers").
    let breadcrumbPath: string[] = []
    try {
      const u = new URL(sourceUrl)
      breadcrumbPath = u.pathname.split('/').filter(Boolean)
    } catch { /* ignore — sourceUrl wasn't a URL */ }

    return {
      identifier: raw.identifier,
      sourceUrl,
      markdown,
      metadata: {
        page_title: title,
        breadcrumb_path: breadcrumbPath,
        page_last_updated: data.metadata?.modifiedTime || data.metadata?.publishedTime || null,
      },
    }
  },
}

/**
 * Call Firecrawl /v1/map to enumerate URLs reachable from `root`.
 * Returns the discovered URLs (excluding `root` itself; the caller
 * adds it back). Empty array on any non-2xx response — callers
 * fall back to the explicit URL list.
 */
async function firecrawlMap(root: string): Promise<string[]> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY env var not set')

  const res = await fetch(`${FIRECRAWL_BASE}/map`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url: root,
      // Firecrawl default is 5000; we cap to keep response payload
      // sane. The pipeline applies its own maxPages cap after.
      limit: HARD_MAX_PAGES,
      ignoreSitemap: false,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Firecrawl /map ${res.status}: ${text.slice(0, 300)}`)
  }
  const json = await res.json() as FirecrawlMapResponse
  if (!json.success || !Array.isArray(json.links)) return []
  return json.links.filter((u): u is string => typeof u === 'string' && u !== root)
}
