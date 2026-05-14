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
 *     includeSubpaths:     string[] (optional — additional URLs scoped under the root)
 *     excludePatterns:     string[] (regex patterns; URLs matching are dropped)
 *     maxPages:            number  (default 50, capped at 200 to keep bills sane)
 *   }
 *
 * discover() returns the root URL plus any explicit includeSubpaths.
 * Sitemap parsing / recursive crawl is a v2 — every URL in v1 is
 * explicit per the brief.
 */

import type { SourceAdapter, DiscoveredItem, RawContent, NormalizedContent, AdapterContext } from './types'

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1'

interface DocsCrawlConfig {
  recrawlIntervalDays?: number
  includeSubpaths?: string[]
  excludePatterns?: string[]
  maxPages?: number
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

export const docsFirecrawlAdapter: SourceAdapter = {
  sourceType: 'docs',

  async discover(ctx: AdapterContext): Promise<DiscoveredItem[]> {
    const cfg = ctx.source.crawlConfig as DocsCrawlConfig
    const root = ctx.source.urlOrIdentifier
    const explicit = (cfg.includeSubpaths ?? []).filter(u => typeof u === 'string' && u.length > 0)
    const items: DiscoveredItem[] = [{ identifier: root }, ...explicit.map(u => ({ identifier: u }))]
    // Drop duplicates while preserving order.
    const seen = new Set<string>()
    return items.filter(i => {
      if (seen.has(i.identifier)) return false
      seen.add(i.identifier)
      return true
    })
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
